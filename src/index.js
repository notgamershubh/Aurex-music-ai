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


    // Hosted AI music generation through Daydream. The provider key stays in a Worker secret.
    if (url.pathname === "/api/ai/music") {
      if (!env.DAYDREAM_API_KEY) return json({ error: "Music provider is not configured yet. Add DAYDREAM_API_KEY as a Cloudflare Worker secret." }, 503);
      const headers = { Authorization: "Bearer " + env.DAYDREAM_API_KEY, "Content-Type": "application/json" };

      if (request.method === "POST") {
        const body = await readBody(request);
        const prompt = String(body?.prompt || "").trim();
        const duration = Math.max(10, Math.min(120, Number(body?.duration) || 30));
        if (!prompt || prompt.length > 400) return json({ error: "Enter a music prompt between 1 and 400 characters." }, 400);
        try {
          const upstream = await fetch("https://gen.daydream.live/v1/songs", {
            method: "POST",
            headers,
            body: JSON.stringify({ prompt, duration, variations: 1 })
          });
          const data = await upstream.json().catch(() => ({}));
          if (!upstream.ok) {
            const message = data.message || data.error || "Music provider request failed.";
            return json({ error: message, provider_status: upstream.status }, upstream.status === 402 ? 402 : 502);
          }
          return json({ ok: true, id: data.id, status: data.status, position: data.position ?? null });
        } catch (error) {
          console.error("AUREX music create error:", error?.message || String(error));
          return json({ error: "Could not reach the music provider. Try again later." }, 502);
        }
      }

      if (request.method === "GET") {
        const id = (url.searchParams.get("id") || "").trim();
        if (!/^sng_[A-Za-z0-9]+$/.test(id)) return json({ error: "A valid music job ID is required." }, 400);
        try {
          const upstream = await fetch("https://gen.daydream.live/v1/songs/" + encodeURIComponent(id), {
            headers: { Authorization: "Bearer " + env.DAYDREAM_API_KEY }
          });
          const data = await upstream.json().catch(() => ({}));
          if (!upstream.ok) return json({ error: data.message || data.error || "Could not check music generation status." }, 502);
          if (data.status === "failed") return json({ ok: false, status: "failed", error: data.error?.message || "Music generation failed. Try another prompt." }, 502);
          const take = data.takes?.[0];
          return json({
            ok: true,
            status: data.status,
            position: data.position ?? null,
            audio_url: data.status === "done" ? (take?.mp3_url || take?.wav_url || null) : null,
            duration: take?.duration ?? null
          });
        } catch (error) {
          console.error("AUREX music status error:", error?.message || String(error));
          return json({ error: "Could not check music generation status. Try again." }, 502);
        }
      }
      return json({ error: "Use GET or POST." }, 405);
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
        const value = result?.response;
        let parsed;

        if (value && typeof value === "object" && !Array.isArray(value)) {
          if (Array.isArray(value.scenes)) {
            parsed = value;
          } else if (typeof value.response === "string") {
            parsed = JSON.parse(value.response);
          } else if (typeof value.text === "string") {
            parsed = JSON.parse(value.text);
          } else {
            throw new Error("Unexpected AI response object; keys: " + Object.keys(value).join(", "));
          }
        } else if (typeof value === "string") {
          let raw = value.trim();
          raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
          const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
          if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
          parsed = JSON.parse(raw);
        } else {
          throw new Error("AI response was empty or had an unsupported format.");
        }
        if (!Array.isArray(parsed.scenes) || parsed.scenes.length < 4) throw new Error("Storyboard did not contain four scenes.");
        const scenes = parsed.scenes.slice(0, 4).map((scene, i) => ({
          title: String(scene.title || ("Scene " + (i + 1))).slice(0, 80),
          image_prompt: String(scene.image_prompt || prompt).slice(0, 1000),
          motion: ["slow-zoom", "pan-left", "pan-right", "rise"].includes(scene.motion) ? scene.motion : "slow-zoom"
        }));
        return json({ ok: true, type: "storyboard", scenes });
      } catch (error) {
        console.error("AUREX video storyboard error; using fallback scenes:", error?.message || String(error));
        const looksGame = /minecraft|game|gaming|boss|battle|fight|esports/i.test(prompt);
        const scenes = [
          { title: "Opening", motion: "slow-zoom", detail: "wide establishing shot, atmospheric fog, dramatic backlighting, deep cinematic composition" },
          { title: "Build-up", motion: "pan-left", detail: "medium-wide shot, rising tension, dynamic lighting, rich environmental details, strong depth" },
          { title: "Climax", motion: "pan-right", detail: "powerful central moment, energetic composition, bright rim lighting, dramatic particles and contrast" },
          { title: "Finale", motion: "rise", detail: "heroic final wide shot, glowing highlights, atmospheric depth, polished cinematic ending" }
        ].map((scene, i) => ({
          title: scene.title,
          motion: scene.motion,
          image_prompt: "Create scene " + (i + 1) + " of a consistent cinematic video based on this idea: " + prompt + ". " +
            (looksGame ? "Use a high-quality game-cinematic visual style, detailed environments, consistent characters and believable game-world materials. " : "Use professional cinematic art direction, coherent subject design and realistic materials. ") +
            scene.detail + ". 16:9 widescreen framing, carefully composed foreground and background, detailed textures, volumetric lighting, natural depth, crisp subject focus, rich but controlled color grading. Keep the visual style and main subject consistent with the other scenes. No text, captions, logos, watermarks or borders."
        }));
        return json({ ok: true, type: "storyboard", fallback: true, scenes });
      }
    }

    // Text-to-image endpoint. First enriches the prompt, then generates with FLUX Schnell.
    if (url.pathname === "/api/ai/image") {
      if (request.method !== "POST") return json({ error: "Use POST." }, 405);
      if (!env.GEMINI_API_KEY && !env.AI) return json({ error: "Image generation is not configured. Add GEMINI_API_KEY as a Cloudflare Worker secret, or configure the Workers AI binding." }, 503);
      const body = await readBody(request);
      const prompt = String(body?.prompt || "").trim();
      if (!prompt || prompt.length > 1000) return json({ error: "Enter an image prompt under 1000 characters." }, 400);
      try {
        let enhancedPrompt = prompt;
        if (body?.enhance !== false) try {
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
        // Prefer Gemini image generation when configured; keep the key server-side in Cloudflare Worker secrets.
        if (env.GEMINI_API_KEY) {
          const geminiResponse = await fetch(
            "https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-lite-image:generateContent",
            {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
              body: JSON.stringify({
                contents: [{ parts: [{ text: enhancedPrompt }] }],
                generationConfig: {
                  responseModalities: ["TEXT", "IMAGE"],
                  imageConfig: { aspectRatio: "16:9", imageSize: "1K" }
                }
              }),
              signal: AbortSignal.timeout(90000)
            }
          );
          const geminiData = await geminiResponse.json().catch(() => ({}));
          if (!geminiResponse.ok) {
            const detail = geminiData?.error?.message || ("Gemini request failed (HTTP " + geminiResponse.status + ").");
            console.error("AUREX Gemini image error:", detail);
            return json({ error: "Gemini image generation failed: " + detail }, geminiResponse.status === 429 ? 429 : 502);
          }
          const parts = geminiData?.candidates?.flatMap(candidate => candidate?.content?.parts || []) || [];
          const imagePart = parts.find(part => part?.inlineData?.data || part?.inline_data?.data);
          const inline = imagePart?.inlineData || imagePart?.inline_data;
          if (!inline?.data) return json({ error: "Gemini returned no image. Check that image generation is enabled for this API key and model." }, 502);
          const mimeType = inline.mimeType || inline.mime_type || "image/png";
          return json({ dataURI: "data:" + mimeType + ";base64," + inline.data, enhanced: enhancedPrompt !== prompt, provider: "Gemini" });
        }

        // Existing Workers AI image generation remains available when no Gemini key is configured.
        const result = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt: enhancedPrompt, steps: 4 });
        if (!result?.image) return json({ error: "Image model returned no image. Check model availability." }, 502);
        return json({ dataURI: "data:image/jpeg;base64," + result.image, enhanced: enhancedPrompt !== prompt, provider: "Workers AI" });
      } catch (error) {
        console.error("AUREX image error:", error?.message || String(error));
        return json({ error: "Image generation unavailable or free usage limit reached." }, 502);
      }
    }

    return json({
      app: "AUREX Music AI",
      status: "online",
      endpoints: ["/api/health", "/api/generate", "/api/ai/chat", "/api/ai/search", "/api/ai/image", "/api/ai/video-scenes"]
    });
  }
};
