import { GoogleGenAI } from "@google/genai";
import { AnalysisResult } from "../types";
import { formatNumber } from "../utils/numberUtils";

// --- SYSTEM INSTRUCTIONS ---
const SYSTEM_INSTRUCTION = `
You are a Quantitative Hedge Fund Manager.
Your task is to output trading decisions based on strict mathematical probabilities using ONLY the provided data.

RULES:
1. NO HALLUCINATION: If a metric is "N/A" or missing, you MUST NOT guess it. State that data is insufficient for that specific indicator.
2. INTEGRITY: Do not assume market conditions if history is empty.
3. OUTPUT: Return PURE JSON.

INSTITUTIONAL ENGINES (LOGIC):
1. You will receive a pre-calculated "Technical Score" (0-100). Use it as the primary driver for "confidenceScore".
2. TARGETS: You MUST choose Target Prices ONLY from the provided "RESISTANCES" or "FIB LEVELS". Do NOT invent random numbers.
3. STOP LOSS: You MUST choose Stop Loss ONLY from "SUPPORTS" or 2 * ATR below entry.
4. Risk: High if Score < 40, Low if Score > 70.

LANGUAGE INSTRUCTION:
You MUST provide the analysis content in Professional Financial Arabic (اللغة العربية).
However, you MUST keep the JSON Keys and specific ENUM values (like BULLISH, BEARISH, LOW, HIGH) in English for code compatibility.

OUTPUT FORMAT:
Return PURE JSON only. No markdown formatting.
JSON Schema:
{
  "prediction": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidenceScore": number (0-100),
  "targetPrice": number,
  "stopLoss": number,
  "reasoning": "شرح تحليلي مفصل واستنتاج منطقي باللغة العربية",
  "keyFactors": ["عامل 1 بالعربية", "عامل 2 بالعربية"],
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "scenario": "شرح السيناريو البديل باللغة العربية",
  "smartMoneyInsights": ["رؤية 1 بالعربية", "رؤية 2 بالعربية"],
  "whaleActivity": {
      "netFlow": "ACCUMULATION" | "DISTRIBUTION" | "NEUTRAL",
      "largeTransactions": number, // 0-100 score
      "sentiment": "ACCUMULATION" | "DISTRIBUTION" | "NEUTRAL",
      "alert": "String explaining whale behavior"
  },
  "newsAnalysis": {
      "impact": "POSITIVE" | "NEGATIVE" | "NEUTRAL",
      "pricedIn": boolean,
      "manipulationRisk": boolean,
      "marketReaction": "ALIGNED" | "DIVERGENT" | "IGNORED",
      "summary": "String analysis of news impact",
      "highImpactAlert": boolean, // TRUE if Global/Existential event < 24h (Hack, Ban, War)
      "eventCategory": "REGULATION" | "HACK" | "MACRO" | "INSTITUTIONAL" | "OTHER"
  }
}
`;

// --- CONFIGURATION ---
const ALIBABA_API_URL_INTL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";
const ALIBABA_API_URL_CN = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

interface ApiConfig {
    provider: 'alibaba' | 'google';
    key: string;
    url?: string;
    model: string;
    region?: 'intl' | 'cn';
}

const getApiConfig = (): ApiConfig => {
    const provider = (localStorage.getItem('ai_provider') as 'alibaba' | 'google') || 'google'; // Default to Google now

    if (provider === 'google') {
        let model = localStorage.getItem('google_model') || 'gemini-3-flash-preview';
        // Fallback for legacy local storage or expired models
        if (model.includes('1.5') || model.includes('2.0-flash')) model = 'gemini-3-flash-preview';
        if (model.includes('exp') || model.includes('2.0-pro')) model = 'gemini-3-pro-preview';

        return {
            provider: 'google',
            key: (localStorage.getItem('google_api_key') || '').trim(),
            model: model
        };
    } else {
        const region = (localStorage.getItem('alibaba_region') as 'intl' | 'cn') || 'intl';
        return {
            provider: 'alibaba',
            key: (localStorage.getItem('alibaba_api_key') || '').trim(),
            url: region === 'cn' ? ALIBABA_API_URL_CN : ALIBABA_API_URL_INTL,
            model: localStorage.getItem('alibaba_model') || 'qwen-plus',
            region
        };
    }
};

// --- VERIFICATION ---
export const verifyApiKey = async (provider: 'alibaba' | 'google', key: string, extra?: any): Promise<{ valid: boolean; error?: string }> => {
    const cleanKey = key.trim();

    try {
        if (provider === 'google') {
            const ai = new GoogleGenAI({ apiKey: cleanKey });
            const model = extra?.model || 'gemini-3-flash-preview';

            // Simple generation to verify key and model access using official SDK
            await ai.models.generateContent({
                model: model,
                contents: "Hello",
            });
            return { valid: true };
        }
        else {
            // Alibaba Verification (Keep using fetch for now)
            const region = extra?.region || 'intl';
            const model = extra?.model || 'qwen-plus';
            const url = region === 'cn' ? ALIBABA_API_URL_CN : ALIBABA_API_URL_INTL;

            const response = await fetch(url, {
                method: "POST",
                headers: { "Authorization": `Bearer ${cleanKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: "user", content: "Hello" }],
                    max_tokens: 5
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                let msg = err.message || (err.error && err.error.message) || "Error";
                if (msg.includes("Access to model denied")) msg = `موديل ${model} غير متاح لهذا المفتاح`;
                if (msg.includes("Incorrect API key")) msg = "مفتاح خطأ أو منطقة خطأ";
                return { valid: false, error: msg };
            }
            return { valid: true };
        }
    } catch (e: any) {
        console.error("Verification Error:", e);
        let errorMsg = e.message || "خطأ في الاتصال أو المفتاح غير صالح";
        if (errorMsg.includes('404')) errorMsg = "موديل الذكاء الاصطناعي غير موجود (404). يرجى اختيار موديل أحدث من الإعدادات.";
        return { valid: false, error: errorMsg };
    }
};

// --- TRADE OUTCOME ANALYSIS ---
export const analyzeTradeOutcome = async (
    coin: string,
    type: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    entry: number,
    stopLoss: number,
    exitPrice: number,
    marketTrend24h: number
): Promise<string> => {
    const config = getApiConfig();
    if (!config.key) return "يرجى التحقق من مفتاح API";

    const prompt = `
    I placed a ${type} trade on ${coin}.
    Entry: ${entry}
    Stop Loss: ${stopLoss}
    It failed and hit ${exitPrice}.
    The coin 24h change is ${marketTrend24h}%.
    
    Explain in 1 very short Arabic sentence why this likely failed based on typical market mechanics (e.g. Stop Hunt, General Crash, False Breakout).
    Start with "سبب الفشل المحتمل:".
    `;

    try {
        if (config.provider === 'google') {
            const ai = new GoogleGenAI({ apiKey: config.key });
            const response = await ai.models.generateContent({
                model: config.model,
                contents: prompt,
            });
            return response.text?.trim() || "تعذر التحليل";
        } else {
            const response = await fetch(config.url!, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${config.key}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: [{ role: "user", content: prompt }]
                })
            });
            const data = await response.json();
            return data.choices?.[0]?.message?.content?.trim() || "تعذر التحليل";
        }
    } catch (e) {
        return "خطأ في الاتصال بالمحلل الذكي";
    }
};

// --- ANALYSIS ---
export const analyzeCoinWithGemini = async (coin: string, techContext: any): Promise<AnalysisResult> => {
    const config = getApiConfig();

    if (!config.key) throw new Error("Missing API Key");

    // SAFETY: Helper to format values as N/A if null/undefined/NaN
    const fmt = (val: any) => {
        if (val === null || val === undefined || isNaN(val)) return "N/A";
        // Use full precision for AI to analyze
        return formatNumber(val, { useGrouping: false, maximumFractionDigits: 10 });
    };

    // Prepare Context
    const historyString = techContext.history.slice(-15).map((h: any) =>
        `[${h.time}: ${formatNumber(h.price, { useGrouping: false, maximumFractionDigits: 10 })}]`
    ).join(', ');

    const newsString = techContext.news?.length > 0
        ? techContext.news.map((n: any) => `- ${n.title}`).join('\n')
        : "No major news.";

    const trendString = techContext.multiTf?.trendStructure?.trend || "UNKNOWN";
    const obRatio = techContext.orderBook?.imbalanceRatio?.toFixed(2) || "N/A";
    const obPressure = techContext.orderBook?.marketPressure || "NEUTRAL";
    const currentVwap = techContext.vwap && techContext.vwap.length > 0 ? formatNumber(techContext.vwap[techContext.vwap.length - 1]) : "N/A";

    if (techContext.mode === 'SCALPING') {
        const prompt = `
    ROLE: Scalping Bot.
    SIGNAL: ${techContext.technicalScore > 60 ? 'BULLISH' : techContext.technicalScore < 40 ? 'BEARISH' : 'NEUTRAL'}.
    DATA: RSI=${fmt(techContext.rsi)}, MACD=${fmt(techContext.macd?.histogram)}, Vol=${fmt(techContext.volume)}.
    TASK: ONE sentence reasoning.
    OUTPUT JSON: { "prediction": "BULLISH"|"BEARISH"|"NEUTRAL", "confidenceScore": ${techContext.technicalScore}, "targetPrice": ${techContext.currentPrice * 1.01}, "stopLoss": ${techContext.currentPrice * 0.995}, "reasoning": "سبب واحد بالعربية" }
        `;

        try {
            const ai = new GoogleGenAI({ apiKey: config.key });
            const response = await ai.models.generateContent({
                model: 'gemini-2.0-flash-exp', // Force fastest model
                contents: prompt,
                // @ts-ignore
                generationConfig: { maxOutputTokens: 100, responseMimeType: "application/json" } // Force speed
            });
            const jsonText = response.text || "{}";
            const parsed = JSON.parse(jsonText);
            return {
                coin,
                price: techContext.currentPrice,
                ...parsed,
                keyFactors: [],
                smartMoneyInsights: [],
                whaleActivity: { netFlow: "N/A", largeTransactions: 0, sentiment: "NEUTRAL", alert: "N/A" },
                newsAnalysis: { impact: "NEUTRAL", pricedIn: false, manipulationRisk: false, marketReaction: "IGNORED", summary: "Skipped for Speed" }
            };
        } catch (e) {
            console.warn("Lite Mode Failed, falling back to full", e);
        }
    }

    const prompt = `
    ROLE: You are a Financial Narrator explaining a Mathematical Algo-Trading Signal.
    INPUT: The Algo has calculated a Technical Score of ${techContext.technicalScore}/100.
    SIGNAL: ${techContext.technicalScore > 60 ? 'BULLISH' : techContext.technicalScore < 40 ? 'BEARISH' : 'NEUTRAL'}.

    TASK: Explain WHY the math model gave this signal using the provided data.
    
    DATA (Verified):
    - RSI: ${fmt(techContext.rsi)}
    - StochRSI (K/D): ${techContext.stochRsi ? `${fmt(techContext.stochRsi.k)}/${fmt(techContext.stochRsi.d)}` : "N/A"}
    - ADX: ${fmt(techContext.adx)} (Trend Strength)
    - Structure: ${techContext.structure?.trend || "RANGING"}
    
    INSTITUTIONAL CONTEXT:
    - Order Book: ${obRatio} Ratio (${obPressure})
    - Volume Profile POC: ${fmt(techContext.volProfile?.poc)}
    
    CRITICAL INSTRUCTION:
    - Do NOT make up your own prediction. Support the Algo's signal.
    - If Score > 60, find bullish confluence defined in metrics.
    - If Score < 40, find bearish confluence.
    - Keep reasoning under 4 lines. Arabic Language.
    
    NEWS CONTEXT:
    ${newsString}
  `;


    try {
        let jsonText = "";

        if (config.provider === 'google') {
            const ai = new GoogleGenAI({ apiKey: config.key });
            const response = await ai.models.generateContent({
                model: config.model,
                contents: prompt,
                config: {
                    systemInstruction: SYSTEM_INSTRUCTION,
                    responseMimeType: "application/json"
                }
            });

            jsonText = response.text || "";

        } else {
            // Alibaba Request
            const response = await fetch(config.url!, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${config.key}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: [
                        { role: "system", content: SYSTEM_INSTRUCTION },
                        { role: "user", content: prompt }
                    ],
                    response_format: { type: "json_object" }
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.message || "Alibaba API Error");
            }
            const data = await response.json();
            jsonText = data.choices?.[0]?.message?.content;
        }

        if (!jsonText) throw new Error("Empty Response from AI");

        // Clean JSON (remove markdown code blocks if present)
        jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();

        const parsed = JSON.parse(jsonText);

        // Fallbacks for arrays to prevent .map crashes if AI omits them
        const result = {
            ...parsed,
            keyFactors: Array.isArray(parsed.keyFactors) ? parsed.keyFactors : [],
            smartMoneyInsights: Array.isArray(parsed.smartMoneyInsights) ? parsed.smartMoneyInsights : [],
            // Ensure nested objects exist
            whaleActivity: parsed.whaleActivity || { netFlow: "N/A", largeTransactions: 0, sentiment: "NEUTRAL", alert: "None" },
            newsAnalysis: parsed.newsAnalysis || { impact: "NEUTRAL", pricedIn: false, manipulationRisk: false, marketReaction: "IGNORED", summary: "N/A" }
        };



        // --- CORE ALIGNMENT: FORCE MATH SIGNAL ---
        // The AI should NOT be allowed to flip the direction determined by the Algorithms.
        // If Score > 60, it MUST be BULLISH. If Score < 40, it MUST be BEARISH.
        const mathSignal = techContext.technicalScore > 60 ? 'BULLISH' : techContext.technicalScore < 40 ? 'BEARISH' : 'NEUTRAL';
        result.prediction = mathSignal;

        // --- SANITIZATION & LOGIC GUARDRAILS ---
        // Ensure strictly logical targets based on prediction type
        if (result.prediction === 'NEUTRAL') {
            // For NEUTRAL, Target = Resistance, Stop = Support
            const nextRes = techContext.structure?.resistances?.find((r: number) => r > techContext.currentPrice);
            result.targetPrice = nextRes || techContext.currentPrice * 1.02; // Default 2% Range High

            const validSupports = techContext.structure?.supports?.filter((s: number) => s < techContext.currentPrice) || [];
            const bestSupport = validSupports.length > 0 ? Math.max(...validSupports) : null;
            result.stopLoss = bestSupport || techContext.currentPrice * 0.98; // Default 2% Range Low
        } else if (result.prediction === 'BULLISH') {
            // FIX: If TP is below Entry (Illogical), use nearest RESISTANCE or default 5%
            if (result.targetPrice <= techContext.currentPrice) {
                const nextRes = techContext.structure?.resistances?.find((r: number) => r > techContext.currentPrice);
                result.targetPrice = nextRes || techContext.currentPrice * 1.05;
            }
            // FIX: If SL is above Entry (Illogical), use nearest SUPPORT or default 5%
            if (result.stopLoss >= techContext.currentPrice) {
                const nextSup = techContext.structure?.supports?.filter((s: number) => s < techContext.currentPrice).pop(); // Last one is closest? Sort check needed.
                // Supports usually sorted asc? Logic says verify sort.
                // Safer: Just take max support < price
                const validSupports = techContext.structure?.supports?.filter((s: number) => s < techContext.currentPrice) || [];
                const bestSupport = validSupports.length > 0 ? Math.max(...validSupports) : null;
                result.stopLoss = bestSupport || techContext.currentPrice * 0.95;
            }
        } else if (result.prediction === 'BEARISH') {
            // FIX: If TP is above Entry (Illogical), use nearest SUPPORT or default 5%
            if (result.targetPrice >= techContext.currentPrice) {
                const validSupports = techContext.structure?.supports?.filter((s: number) => s < techContext.currentPrice) || [];
                const bestSupport = validSupports.length > 0 ? Math.max(...validSupports) : null;
                result.targetPrice = bestSupport || techContext.currentPrice * 0.95;
            }
            // FIX: If SL is below Entry (Illogical), use nearest RESISTANCE or default 5%
            if (result.stopLoss <= techContext.currentPrice) {
                const nextRes = techContext.structure?.resistances?.find((r: number) => r > techContext.currentPrice);
                result.stopLoss = nextRes || techContext.currentPrice * 1.05;
            }
        }

        // --- SECONDARY GUARD: PERCENTAGE CLAMP (Anti-Crash/Hallucination) ---
        // Prevent AI from setting targets > 20% away (Unrealistic for day trading) unless it's Investing
        // Exception: If mode is INVESTING, we allow wider ranges.
        const MAX_DEV = (techContext.mode === 'INVESTING' || techContext.mode === 'SWING') ? 0.50 : 0.15; // 50% for Swing/Inv, 15% for Day/Scalp

        const distTp = Math.abs((result.targetPrice - techContext.currentPrice) / techContext.currentPrice);
        const distSl = Math.abs((result.stopLoss - techContext.currentPrice) / techContext.currentPrice);

        if (distTp > MAX_DEV) {
            // Clamp to MAX_DEV
            if (result.prediction === 'BULLISH') result.targetPrice = techContext.currentPrice * (1 + MAX_DEV);
            if (result.prediction === 'BEARISH') result.targetPrice = techContext.currentPrice * (1 - MAX_DEV);
        }
        if (distSl > MAX_DEV) {
            // Clamp to MAX_DEV
            if (result.prediction === 'BULLISH') result.stopLoss = techContext.currentPrice * (1 - MAX_DEV);
            if (result.prediction === 'BEARISH') result.stopLoss = techContext.currentPrice * (1 + MAX_DEV);
        }

        return { coin, price: techContext.currentPrice, ...result };

    } catch (error: any) {
        console.error("Analysis Failed:", error);

        let userMessage = `فشل التحليل: ${error.message || 'خطأ غير معروف'}.`;
        if (error.message && error.message.includes('404')) {
            userMessage = "خطأ 404: موديل الذكاء الاصطناعي المحدد غير مدعوم حالياً أو غير متوفر لهذا المفتاح. يرجى اختيار موديل أحدث من الإعدادات.";
        }

        return {
            coin,
            price: techContext.currentPrice,
            prediction: 'NEUTRAL',
            targetPrice: techContext.currentPrice,
            stopLoss: techContext.currentPrice * 0.95,
            confidenceScore: 0,
            timeframe: '4H',
            reasoning: userMessage,
            keyFactors: ["Error"],
            smartMoneyInsights: [],
            newsAnalysis: { impact: "NEUTRAL", pricedIn: false, manipulationRisk: false, marketReaction: "IGNORED", summary: "N/A" },
            riskLevel: "HIGH",
            scenario: "يرجى التحقق من إعدادات API في القائمة الجانبية.",
            whaleActivity: { netFlow: "N/A", largeTransactions: 0, sentiment: "NEUTRAL", alert: "N/A" }
        };
    }
};