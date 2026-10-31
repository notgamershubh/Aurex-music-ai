export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    if (url.pathname === "/api/health") {
      return Response.json(
        { ok: true, app: "AUREX Music AI" },
        { headers: corsHeaders() }
      );
    }

    if (url.pathname === "/api/generate" && request.method === "POST") {
      return Response.json(
        {
          ok: false,
          message:
            "Backend ready. A compatible video-generation model must be connected before real AI clips can be generated."
        },
        { status: 501, headers: corsHeaders() }
      );
    }

    return Response.json(
      { app: "AUREX Music AI", status: "online" },
      { headers: corsHeaders() }
    );
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
