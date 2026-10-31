const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

async function readBody(request) {
  try { return await request.json(); }
  catch { return null; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        app: "AUREX Music AI",
        aiConfigured: Boolean(env.AI),
        model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
      });
    }

    // Existing AUREX Music Studio editing-plan endpoint — preserved.
    if (url.pathname === "/api/generate") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Send a POST request to generate an editing plan." }, 405);
      }
      if (!env.AI) return json({ ok: false, error: "AI binding missing. Check wrangler.jsonc." }, 503);

      const body = await readBody(request);
      if (!body) return json({ ok: false, error: "Invalid JSON request." }, 400);

      const prompt = String(body.prompt ?? "").trim();
      const style = String(body.style ?? "cinematic").trim().slice(0, 60);
      if (!prompt || prompt.length > 1500) {
        return json({ ok: false, error: "Enter a prompt between 1 and 1500 characters." }, 400);
      }

      try {
        const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
          messages: [
            {
              role: "system",
              content: "You are AUREX Music Studio's video editing assistant. Create a concise, useful music-video editing plan. Return a JSON object with keys: title, visual_direction, cut_style, effects, music_sync. Do not claim to render or create a video file."
            },
            { role: "user", content: "Video idea: " + prompt + "\nVisual style: " + (style || "cinematic") }
          ],
          max_tokens: 350
        });

        const answer = result?.response;
        if (typeof answer !== "string" || !answer.trim()) {
          return json({ ok: false, error: "AI returned an empty response. Check Worker logs." }, 502);
        }
        return json({ ok: true, app: "AUREX Music AI", type: "editing_plan", plan: answer.trim() });
      } catch (error) {
        console.error("AUREX editing-plan error:", error?.message || String(error));
        return json({ ok: false, error: "AI generation failed. Check Workers AI model availability and usage limits." }, 502);
      }
    }

    // New AUREX AI chat and coding endpoint.
    if (url.pathname === "/api/ai/chat") {
      if (request.method !== "POST") return json({ error: "Use POST." }, 405);
      if (!env.AI) return json({ error: "Workers AI binding is missing." }, 503);
      const body = await readBody(request);
      if (!body || !Array.isArray(body.messages)) return json({ error: "Send a messages array." }, 400);

      const messages = body.messages.slice(-12)
        .filter(m => ["user", "assistant"].includes(m?.role) && typeof m?.content === "string")
        .map(m => ({ role: m.role, content: m.content.slice(0, 5000) }));

      if (!messages.length) return json({ error: "Type a message first." }, 400);

      try {
        const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
          messages: [
            { role: "system", content: "You are AUREX AI, a helpful multilingual assistant. Reply in the user's language. Help with explanations, coding and debugging. Reply directly, avoid unnecessary filler, and prefer concise answers unless detail is requested. Be clear and honest; do not claim to browse the internet or run code unless you actually did." },
            ...messages
          ],
          max_tokens: 800
        });
        if (!result?.response) return json({ error: "The AI returned an empty reply. Try again later." }, 502);
        return json({ reply: result.response });
      } catch (error) {
        console.error("AUREX chat error:", error?.message || String(error));
        return json({ error: "Chat model unavailable or free usage limit reached. Try again later." }, 502);
      }
    }

    // Simple public search through Wikipedia's search API.
    if (url.pathname === "/api/ai/search") {
      if (request.method !== "GET") return json({ error: "Use GET." }, 405);
      const q = (url.searchParams.get("q") || "").trim().slice(0, 180);
      if (!q) return json({ error: "Enter something to search." }, 400);
      try {
        // Use Hindi Wikipedia for Devanagari queries; English otherwise.
        const lang = /[\u0900-\u097F]/.test(q) ? "hi" : "en";
        const searchURL = new URL("https://" + lang + ".wikipedia.org/w/api.php");
        searchURL.search = new URLSearchParams({
          action: "opensearch", search: q, limit: "5", namespace: "0", format: "json"
        });
        const response = await fetch(searchURL.toString(), {
          headers: { "User-Agent": "AUREXAI/1.0 (Wikipedia search)" },
          signal: AbortSignal.timeout(12000)
        });
        if (!response.ok) return json({ error: "Wikipedia search provider unavailable. Try again." }, 502);
        const data = await response.json();
        return json({
          provider: lang === "hi" ? "Hindi Wikipedia" : "Wikipedia",
          results: (data[1] || []).map((title, i) => ({
            title,
            description: data[2]?.[i] || "",
            url: data[3]?.[i] || ""
          }))
        });
      } catch {
        return json({ error: "Search failed. Try again." }, 502);
      }
    }

    // Prompt-to-video storyboard: generates scene prompts; the browser renders them into an animated WebM.
    if (url.pathname === "/api/ai/video-scenes") {
      if (request.method !== "POST") return json({ error: "Use POST." }, 405);
      if (!env.AI) return json({ error: "Workers AI binding is missing." }, 503);
      const body = await readBody(request);
      const prompt = String(body?.prompt || "").trim();
      if (!prompt || prompt.length > 1000) return json({ error: "Enter a video prompt under 1000 characters." }, 400);
      try {
        const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
          messages: [
            { role: "system", content: "You are a cinematic storyboard director. Return ONLY valid JSON, no markdown, with a scenes array of exactly 4 objects. Each object has: title (short), image_prompt (a detailed standalone visual prompt in English, 80-140 words), motion (one of slow-zoom, pan-left, pan-right, rise). Keep the same characters, world, and visual style consistent across all four scenes. Include composition, lighting, atmosphere, textures, depth, and camera lens. No text, logos, watermarks, or captions inside the generated images." },
            { role: "user", content: "Create four sequential cinematic scenes for this video idea: " + prompt }
          ],
          max_tokens: 1100
        });
        let raw = String(result?.response || "").trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.scenes) || parsed.scenes.length < 4) throw new Error("Storyboard did not contain four scenes.");
        const scenes = parsed.scenes.slice(0, 4).map((scene, i) => ({
          title: String(scene.title || ("Scene " + (i + 1))).slice(0, 80),
          image_prompt: String(scene.image_prompt || prompt).slice(0, 1000),
          motion: ["slow-zoom", "pan-left", "pan-right", "rise"].includes(scene.motion) ? scene.motion : "slow-zoom"
        }));
        return json({ ok: true, type: "storyboard", scenes });
      } catch (error) {
        console.error("AUREX video storyboard error:", error?.message || String(error));
        return json({ error: "Could not create a video storyboard. Try a shorter prompt or check the free AI usage limit." }, 502);
      }
    }

    // Text-to-image endpoint. First enriches the prompt, then generates with FLUX Schnell.
    if (url.pathname === "/api/ai/image") {
      if (request.method !== "POST") return json({ error: "Use POST." }, 405);
      if (!env.AI) return json({ error: "Workers AI binding is missing." }, 503);
      const body = await readBody(request);
      const prompt = String(body?.prompt || "").trim();
      if (!prompt || prompt.length > 1000) return json({ error: "Enter an image prompt under 1000 characters." }, 400);
      try {
        let enhancedPrompt = prompt;
        try {
          const enhancement = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
            messages: [
              { role: "system", content: "You are an expert text-to-image art director. Rewrite the user's idea as one vivid, precise image-generation prompt. Preserve the subject and intent. Add strong composition, lighting, depth, material detail, coherent color palette, anatomy/object accuracy, and professional art direction. If the user asks for a logo, prioritize clean shapes, readable lettering, and a centered icon. Avoid contradictory instructions. Return only the prompt, no explanations, no quotes, no negative prompt." },
              { role: "user", content: prompt }
            ],
            max_tokens: 220
          });
          if (typeof enhancement?.response === "string" && enhancement.response.trim()) {
            enhancedPrompt = enhancement.response.trim().slice(0, 1800);
          }
        } catch (enhanceError) {
          console.warn("AUREX prompt enhancement skipped:", enhanceError?.message || String(enhanceError));
        }
        const result = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt: enhancedPrompt, steps: 4 });
        if (!result?.image) return json({ error: "Image model returned no image. Check model availability." }, 502);
        return json({ dataURI: "data:image/jpeg;base64," + result.image, enhanced: enhancedPrompt !== prompt });
      } catch (error) {
        console.error("AUREX image error:", error?.message || String(error));
        return json({ error: "Image generation unavailable or free usage limit reached." }, 502);
      }
    }

    return json({
      app: "AUREX Music AI",
      status: "online",
      endpoints: ["/api/health", "/api/generate", "/api/ai/chat", "/api/ai/search", "/api/ai/image"]
    });
  }
};
