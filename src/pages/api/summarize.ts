import type { APIRoute } from 'astro';
import { getSession } from '../../lib/auth';
import { parse } from 'cookie';

export const POST: APIRoute = async ({ request }) => {
  // Simple auth check
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = parse(cookieHeader);
  const session = cookies.session ? await getSession(cookies.session) : null;

  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const geminiApiKey = process.env.GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY;
  const groqApiKey = process.env.GROQ_API_KEY || import.meta.env.GROQ_API_KEY;

  if (!geminiApiKey && !groqApiKey) {
    return new Response(JSON.stringify({ error: 'Neither Gemini nor Groq API keys are configured in the environment.' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const { type, label, entries } = await request.json();

    if (!type || !entries || !Array.isArray(entries)) {
      return new Response(JSON.stringify({ error: 'Invalid request data. Requires type and entries.' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Format tasks list
    const tasksList = entries
      .map((e: any) => `- ${e.date}: ${e.description || 'General Work'} (${(e.durationSeconds / 3600).toFixed(2)} hours)`)
      .join('\n');

    let systemInstruction = 'You are a helpful internship mentor assisting a student in writing professional journal entries for their internship DTR (Daily Time Record) or internship logbook.';
    let promptText = '';

    if (type === 'day') {
      promptText = `Write a professional, concise, first-person internship journal log entry (around 1-3 sentences) summarizing the following task completed on ${label}:\n\n${tasksList}\n\nMake it professional, action-oriented, and highlight the learning value or core activity. Do not include introductory phrases like "Here is your summary..." or "Journal Entry:". Write ONLY the final journal text itself.`;
    } else if (type === 'week') {
      promptText = `Write a professional, cohesive, first-person internship journal log entry (around 1-2 paragraphs) summarizing the tasks completed during the ${label}:\n\n${tasksList}\n\nGroup related tasks together and present them in a coherent, professional narrative suitable for a student's weekly internship report. Highlight any technical skills, soft skills, or milestones. Do not include introductory phrases like "Here is your summary..." or "Weekly Journal:". Write ONLY the final journal text itself.`;
    } else if (type === 'month') {
      promptText = `Write a comprehensive, professional, first-person internship journal log entry (around 2-3 paragraphs) summarizing the achievements and work completed during ${label}:\n\n${tasksList}\n\nSynthesize the key contributions, projects, and learning outcomes in a professional summary suitable for a monthly internship journal report. Highlight development, responsibilities, and overall progress. Do not include introductory phrases like "Here is your summary..." or "Monthly Journal:". Write ONLY the final journal text itself.`;
    } else {
      return new Response(JSON.stringify({ error: 'Unsupported summary type.' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let text = '';
    let usedModel = '';
    let usedProvider = '';

    // 1. Try Gemini first (if key is available)
    if (geminiApiKey) {
      const modelsToTry = [
        'models/gemini-2.5-flash',
        'models/gemini-3.5-flash',
        'models/gemini-flash-latest',
        'models/gemini-2.0-flash',
        'models/gemini-2.5-pro',
        'models/gemini-pro-latest'
      ];

      let response: Response | null = null;
      let lastError = '';

      for (const modelName of modelsToTry) {
        try {
          console.log(`[summarize.ts] Trying Gemini model ${modelName}...`);
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${geminiApiKey}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      text: `${systemInstruction}\n\nPrompt:\n${promptText}`
                    }
                  ]
                }
              ],
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2048
              }
            })
          });

          if (res.ok) {
            response = res;
            usedModel = modelName;
            console.log(`[summarize.ts] Success with Gemini ${modelName}`);
            break;
          } else {
            const errorText = await res.text();
            lastError = `Model ${modelName} returned status ${res.status}: ${errorText}`;
            console.warn(`[summarize.ts] ${lastError}`);
          }
        } catch (err: any) {
          lastError = `Model ${modelName} request failed: ${err.message}`;
          console.warn(`[summarize.ts] ${lastError}`);
        }
      }

      if (response && response.ok) {
        const data = await response.json();
        text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (text) {
          usedProvider = 'gemini';
        }
      }
    }

    // 2. Try Groq as fallback (if Gemini failed/skipped and Groq key is available)
    if (!text && groqApiKey) {
      const groqModels = [
        'llama-3.3-70b-versatile',
        'llama3-8b-8192',
        'mixtral-8x7b-32768'
      ];

      let response: Response | null = null;
      let lastError = '';

      for (const modelName of groqModels) {
        try {
          console.log(`[summarize.ts] Falling back to Groq model ${modelName}...`);
          const res = await fetch(`https://api.groq.com/openai/v1/chat/completions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${groqApiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: modelName,
              messages: [
                {
                  role: 'system',
                  content: systemInstruction
                },
                {
                  role: 'user',
                  content: promptText
                }
              ],
              temperature: 0.7,
              max_tokens: 2048
            })
          });

          if (res.ok) {
            response = res;
            usedModel = modelName;
            console.log(`[summarize.ts] Success with Groq model ${modelName}`);
            break;
          } else {
            const errorText = await res.text();
            lastError = `Groq model ${modelName} returned status ${res.status}: ${errorText}`;
            console.warn(`[summarize.ts] ${lastError}`);
          }
        } catch (err: any) {
          lastError = `Groq model ${modelName} request failed: ${err.message}`;
          console.warn(`[summarize.ts] ${lastError}`);
        }
      }

      if (response && response.ok) {
        const data = await response.json();
        text = data.choices?.[0]?.message?.content || '';
        if (text) {
          usedProvider = 'groq';
        }
      }
    }

    if (!text) {
      return new Response(JSON.stringify({ error: 'All AI models from both Gemini and Groq providers are currently busy or unavailable. Please try again later.' }), { 
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Trim backticks or formatting blocks if returned
    text = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();

    return new Response(JSON.stringify({ text, model: usedModel, provider: usedProvider }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Server error' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
