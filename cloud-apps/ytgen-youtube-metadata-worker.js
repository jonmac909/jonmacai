export default {
  async fetch(request) {
    const url = new URL(request.url);
    const sourceUrl = url.searchParams.get("url") || "";
    const idMatch =
      sourceUrl.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/) ||
      sourceUrl.match(/^([a-zA-Z0-9_-]{11})$/);
    const videoId = idMatch ? idMatch[1] : "";
    if (!videoId) {
      return Response.json(
        { ok: false, error: "Could not pull the YouTube title and thumbnail." },
        { status: 400 }
      );
    }

    let title = "";
    let authorName = "";
    try {
      const oembed = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
      );
      if (oembed.ok) {
        const payload = await oembed.json();
        title = payload && payload.title ? String(payload.title) : "";
        authorName = payload && payload.author_name ? String(payload.author_name) : "";
      }
    } catch (error) {}

    return Response.json({
      ok: true,
      video: {
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: title || videoId,
        authorName: authorName || "Custom source",
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      },
    });
  },
};
