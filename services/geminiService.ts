
import { UserInput, LifeDestinyResult, Gender } from "../types";
import { BAZI_SYSTEM_INSTRUCTION } from "../constants";

// Helper to determine stem polarity
const getStemPolarity = (pillar: string): 'YANG' | 'YIN' => {
  if (!pillar) return 'YANG'; // default
  const firstChar = pillar.trim().charAt(0);
  const yangStems = ['甲', '丙', '戊', '庚', '壬'];
  const yinStems = ['乙', '丁', '己', '辛', '癸'];

  if (yangStems.includes(firstChar)) return 'YANG';
  if (yinStems.includes(firstChar)) return 'YIN';
  return 'YANG'; // fallback
};

export const generateLifeAnalysis = async (input: UserInput): Promise<LifeDestinyResult> => {

  const { apiKey, apiBaseUrl, modelName } = input;

  if (!apiKey || !apiKey.trim()) {
    throw new Error("请在表单中填写有效的 API Key");
  }
  if (!apiBaseUrl || !apiBaseUrl.trim()) {
    throw new Error("请在表单中填写有效的 API Base URL");
  }

  // Remove trailing slash if present
  const cleanBaseUrl = apiBaseUrl.replace(/\/+$/, "");
  // Use user provided model name or fallback
  const targetModel = modelName && modelName.trim() ? modelName.trim() : "gemini-3-pro-preview";

  const genderStr = input.gender === Gender.MALE ? '男 (乾造)' : '女 (坤造)';
  const startAgeInt = parseInt(input.startAge) || 1;

  // Calculate Da Yun Direction accurately
  const yearStemPolarity = getStemPolarity(input.yearPillar);
  let isForward = false;

  if (input.gender === Gender.MALE) {
    isForward = yearStemPolarity === 'YANG';
  } else {
    isForward = yearStemPolarity === 'YIN';
  }

  const daYunDirectionStr = isForward ? '顺行 (Forward)' : '逆行 (Backward)';

  const directionExample = isForward
    ? "例如：第一步是【戊申】，第二步则是【己酉】（顺排）"
    : "例如：第一步是【戊申】，第二步则是【丁未】（逆排）";

  const userPrompt = `
    请根据以下**已经排好的**八字四柱和**指定的大运信息**进行分析。
    
    【基本信息】
    性别：${genderStr}
    姓名：${input.name || "未提供"}
    出生年份：${input.birthYear}年 (阳历)
    
    【八字四柱】
    年柱：${input.yearPillar} (天干属性：${yearStemPolarity === 'YANG' ? '阳' : '阴'})
    月柱：${input.monthPillar}
    日柱：${input.dayPillar}
    时柱：${input.hourPillar}
    
    【大运核心参数】
    1. 起运年龄：${input.startAge} 岁 (虚岁)。
    2. 第一步大运：${input.firstDaYun}。
    3. **排序方向**：${daYunDirectionStr}。
    
    【必须执行的算法 - 大运序列生成】
    请严格按照以下步骤生成数据：
    
    1. **锁定第一步**：确认【${input.firstDaYun}】为第一步大运。
    2. **计算序列**：根据六十甲子顺序和方向（${daYunDirectionStr}），推算出接下来的 9 步大运。
       ${directionExample}
    3. **填充 JSON**：
       - Age 1 到 ${startAgeInt - 1}: daYun = "童限"
       - Age ${startAgeInt} 到 ${startAgeInt + 9}: daYun = [第1步大运: ${input.firstDaYun}]
       - Age ${startAgeInt + 10} 到 ${startAgeInt + 19}: daYun = [第2步大运]
       - Age ${startAgeInt + 20} 到 ${startAgeInt + 29}: daYun = [第3步大运]
       - ...以此类推直到 100 岁。
    
    【特别警告】
    - **daYun 字段**：必须填大运干支（10年一变），**绝对不要**填流年干支。
    - **ganZhi 字段**：填入该年份的**流年干支**（每年一变，例如 2024=甲辰，2025=乙巳）。
    
    任务：
    1. 确认格局与喜忌。
    2. 生成 **1-100 岁 (虚岁)** 的人生流年K线数据。
    3. 在 \`reason\` 字段中提供流年详批。
    4. 生成带评分的命理分析报告。
    
    请严格按照系统指令生成 JSON 数据。
  `;

  try {
    let response;
    let retries = 3;
    let attempt = 0;

    while (attempt < retries) {
      try {
        response = await fetch(`${cleanBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: targetModel,
            messages: [
              { role: "system", content: BAZI_SYSTEM_INSTRUCTION },
              { role: "user", content: userPrompt }
            ],
            response_format: { type: "json_object" },
            temperature: 0.7
          })
        });

        if (response.status === 503) {
          attempt++;
          console.warn(`Attempt ${attempt} failed with 503. Retrying...`);
          if (attempt >= retries) {
            const errText = await response.text();
            throw new Error(`API 请求失败 (503 Service Unavailable) - 已重试 ${retries} 次: ${errText}`);
          }
          // Simple backoff: 1s, 2s, 3s... or fixed 2s
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
          continue;
        }

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`API 请求失败: ${response.status} - ${errText}`);
        }

        // If success, break loop
        break;

      } catch (err: any) {
        // If it's a network error (fetch failed entirely), we might also want to retry, 
        // but for now only targeting explicit 503 response as requested.
        // Or if we threw 503 error above, rethrow it.
        if (err.message.includes('503')) throw err;

        // Retrying on network connection errors is also good practice
        attempt++;
        if (attempt >= retries) throw err;
        console.warn(`Attempt ${attempt} failed with network error. Retrying...`, err.message);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (!response) {
      throw new Error("API 请求发生未知错误");
    }


    const jsonResult = await response.json();
    const content = jsonResult.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("模型未返回任何内容。");
    }

    // 解析 JSON
    let data;
    try {
      let cleanContent = content;

      // 1. 移除 Markdown 代码块标记 (```json ... ```)
      cleanContent = cleanContent.replace(/```json/gi, "").replace(/```/g, "");

      // 2. 寻找最外层的 JSON 对象 {}
      const firstBrace = cleanContent.indexOf('{');
      const lastBrace = cleanContent.lastIndexOf('}');

      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleanContent = cleanContent.substring(firstBrace, lastBrace + 1);
      }

      data = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error("JSON Parse Error. Raw content:", content);
      throw new Error(`模型返回的数据格式无法解析。请重试。\n原始数据片段: ${content.substring(0, 50)}...`);
    }

    // 简单校验数据完整性 (宽松模式: 只要有 chartPoints 数组即可)
    if (!data?.chartPoints || !Array.isArray(data.chartPoints)) {
      throw new Error("模型返回的数据缺少关键字段 chartPoints。");
    }

    return {
      chartData: data.chartPoints,
      analysis: {
        bazi: data.bazi || [],
        summary: data.summary || "无摘要",
        summaryScore: data.summaryScore || 5,
        industry: data.industry || "无",
        industryScore: data.industryScore || 5,
        wealth: data.wealth || "无",
        wealthScore: data.wealthScore || 5,
        marriage: data.marriage || "无",
        marriageScore: data.marriageScore || 5,
        health: data.health || "无",
        healthScore: data.healthScore || 5,
        family: data.family || "无",
        familyScore: data.familyScore || 5,
      },
    };
  } catch (error) {
    console.error("Gemini/OpenAI API Error:", error);
    throw error;
  }
};
