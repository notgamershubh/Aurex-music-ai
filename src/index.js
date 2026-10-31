const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        app: "AUREX Music AI",
        aiConfigured: Boolean(env.AI),
        model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
      });
    }

    if (url.pathname === "/api/generate") {
      if (request.method !== "POST") {
        return json({
          ok: false,
          error: "Send a POST request to generate an editing plan."
        }, 405);
      }

      if (!env.AI) {
        return json({
          ok: false,
          error: "AI binding missing. Check wrangler.jsonc."
        }, 503);
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return json({
          ok: false,
          error: "Invalid JSON request."
        }, 400);
      }

      const prompt = String(body?.prompt ?? "").trim();
      const style = String(body?.style ?? "cinematic")
        .trim()
        .slice(0, 60);

      if (!prompt || prompt.length > 1500) {
        return json({
          ok: false,
          error: "Enter a prompt between 1 and 1500 characters."
        }, 400);
      }

      try {
        const result = await env.AI.run(
          "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
          {
            messages: [
              {
                role: "system",
                content:
                  "You are AUREX Music Studio's video editing assistant. " +
                  "Create a concise, useful music-video editing plan. " +
                  "Return a JSON object with keys: title, " +
                  "visual_direction, cut_style, effects, music_sync. " +
                  "Do not claim to render or create a video file."
              },
              {
                role: "user",
                content:
                  "Video idea: " + prompt +
                  "\nVisual style: " + (style || "cinematic")
              }
            ],
            max_tokens: 350
          }
        );

        const answer = result?.response;

        if (typeof answer !== "string" || !answer.trim()) {
          console.error(
            "Unexpected Workers AI response:",
            JSON.stringify(result)
          );

          return json({
            ok: false,
            error: "AI returned an empty response. Check Worker logs."
          }, 502);
        }

        return json({
          ok: true,
          app: "AUREX Music AI",
          type: "editing_plan",
          plan: answer.trim()
        });

      } catch (error) {
        console.error("AUREX AI error:", {
          message: error?.message || String(error),
          stack: error?.stack || null
        });

        return json({
          ok: false,
          error: "AI generation failed.",
          details: String(
            error?.message || "Unknown Workers AI error"
          ).slice(0, 500)
        }, 502);
      }
    }

    return json({
      app: "AUREX Music AI",
      status: "online",
      endpoints: ["/api/health", "/api/generate"]
    });
  }
};
