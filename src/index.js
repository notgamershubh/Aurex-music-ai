const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        app: "AUREX Music AI",
        aiConfigured: Boolean(env.AI)
      }, { headers: corsHeaders });
    }

    if (url.pathname === "/api/generate" && request.method === "POST") {
      try {
        if (!env.AI) {
          return Response.json({
            ok: false,
            error: "Workers AI binding is missing. Check wrangler.jsonc."
          }, { status: 503, headers: corsHeaders });
        }

        const body = await request.json();
        const prompt = String(body.prompt || "").trim();
        const style = String(body.style || "cinematic").slice(0, 60);

        if (!prompt || prompt.length > 1500) {
          return Response.json({
            ok: false,
            error: "Enter a prompt between 1 and 1500 characters."
          }, { status: 400, headers: corsHeaders });
        }

        const result = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              {
                role: "system",
                content:
                  "You are AUREX Music Studio's video editor assistant. " +
                  "Turn the user's idea into a concise video-editing plan. " +
                  "Return JSON with keys title, visual_direction, " +
                  "cut_style, effects, and music_sync. Do not claim " +
                  "to create or render video files."
              },
              {
                role: "user",
                content: `Video idea: ${prompt}\nStyle: ${style}`
              }
            ],
            max_tokens: 350
          }
        );

        return Response.json({
          ok: true,
          app: "AUREX Music AI",
          type: "editing_plan",
          plan: result.response || "No plan returned."
        }, { headers: corsHeaders });

      } catch (error) {
        return Response.json({
          ok: false,
          error: "AI request failed. Check model availability and quota."
        }, { status: 502, headers: corsHeaders });
      }
    }

    return Response.json({
      app: "AUREX Music AI",
      status: "online",
      endpoints: ["/api/health", "/api/generate"]
    }, { headers: corsHeaders });
  }
};
