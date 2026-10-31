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

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        ok: true,
        app: "AUREX Music AI",
        aiConfigured: Boolean(env.AI),
        model: env.AI_MODEL || "@cf/meta/llama-3.1-8b-instruct"
      });
    }

    if (url.pathname === "/api/generate") {
      if (request.method !== "POST") {
        return json({
          ok: false,
          error: "Use POST to generate an editing plan."
        }, 405);
      }

      if (!env.AI) {
        return json({
          ok: false,
          error: "Workers AI binding is missing. Check wrangler.jsonc."
        }, 503);
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return json({
          ok: false,
          error: "Invalid JSON request body."
        }, 400);
      }

      const prompt = String(body?.prompt ?? "").trim();
      const style = String(body?.style ?? "cinematic")
        .trim()
        .slice(0, 60);

      if (!prompt || prompt.length > 1500) {
        return json({
          ok: false,
          error: "Prompt must contain 1–1500 characters."
        }, 400);
      }

      try {
        const model =
          env.AI_MODEL || "@cf/meta/llama-3.1-8b-instruct";

        const result = await env.AI.run(model, {
          messages: [
            {
              role: "system",
              content:
                "You are AUREX Music Studio, a video editing assistant. " +
                "Create a useful editing plan for the user's music video. " +
                "Return a JSON object with these keys: title, " +
                "visual_direction, cut_style, effects, music_sync. " +
                "Be concise. Do not claim that a video was rendered."
            },
            {
              role: "user",
              content:
                "Video idea: " + prompt + "\n" +
                "Visual style: " + (style || "cinematic")
            }
          ],
          max_tokens: 350
        });

        const answer =
          typeof result?.response === "string"
            ? result.response.trim()
            : "";

        if (!answer) {
          console.error(
            "AUREX AI returned an empty or unexpected response:",
            JSON.stringify(result)
          );

          return json({
            ok: false,
            error: "The AI returned no text. Check Worker logs."
          }, 502);
        }

        return json({
          ok: true,
          app: "AUREX Music AI",
          type: "editing_plan",
          plan: answer
        });

      } catch (error) {
        // Full error appears in Cloudflare Worker logs.
        console.error("AUREX AI generation failed:", {
          message: error?.message || String(error),
          stack: error?.stack || "No stack available"
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
    }, 404);
  }
};
