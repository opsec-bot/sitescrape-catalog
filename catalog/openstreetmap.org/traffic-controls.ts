import { EndpointError, defineEndpoint, z, type Context } from "sitescrape";

// Public Overpass instances. They are shared and often overloaded, and which one is
// fast changes by the hour, so the query goes to all of them and the first good answer
// wins. Set OVERPASS_ENDPOINT to use only your own mirror or a local Overpass.
const ENDPOINTS = process.env.OVERPASS_ENDPOINT
  ? [process.env.OVERPASS_ENDPOINT]
  : [
      "https://overpass-api.de/api/interpreter",
      "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
    ];

interface OverpassNode {
  type: string;
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

type OverpassResult = { elements?: OverpassNode[]; remark?: string };

const box = z
  .tuple([z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180)])
  .refine(([s, w, n, e]) => s < n && w < e && n - s <= 0.5 && e - w <= 0.5, "box must be south,west,north,east and at most 0.5 degrees a side")
  .describe("[south, west, north, east] in degrees");

const control = z.object({
  id: z.number().int().describe("OSM node id"),
  lat: z.number(),
  lon: z.number(),
  kind: z.enum(["signal", "stop", "all_way_stop", "give_way"]),
  direction: z.string().nullable().describe("OSM direction tag (forward, backward, both) when the sign applies one way"),
});

export function buildQuery(boxes: [number, number, number, number][]): string {
  const clauses = boxes.map(
    ([s, w, n, e]) => `  node["highway"~"^(traffic_signals|stop|give_way)$"](${s},${w},${n},${e});`,
  );
  return `[out:json][timeout:60];\n(\n${clauses.join("\n")}\n);\nout body;`;
}

function classify(tags: Record<string, string>): z.infer<typeof control>["kind"] | null {
  switch (tags.highway) {
    case "traffic_signals":
      return "signal";
    case "stop":
      return tags.stop === "all" ? "all_way_stop" : "stop";
    case "give_way":
      return "give_way";
    default:
      return null;
  }
}

async function raceOverpass(ctx: Context, body: string): Promise<OverpassResult> {
  const abort = new AbortController();
  const attempts = ENDPOINTS.map(async (endpoint) => {
    const result = await ctx.json<OverpassResult>(endpoint, {
      method: "POST",
      body,
      signal: abort.signal,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "sitescrape-catalog (+https://github.com/opsec-bot/sitescrape-catalog)",
      },
    });
    // A query that runs out of time or memory still comes back as HTTP 200, with no
    // elements and the reason in `remark`. That is a failure, not an empty road.
    if (result.remark && /error/i.test(result.remark)) {
      throw new EndpointError(`Overpass: ${result.remark}`, "upstream");
    }
    return result;
  });
  try {
    return await Promise.any(attempts);
  } catch (err) {
    const first = err instanceof AggregateError ? err.errors[0] : err;
    throw first instanceof EndpointError ? first : new EndpointError(`every Overpass endpoint failed: ${first}`, "upstream");
  } finally {
    abort.abort();
  }
}

// Boxes rather than a route line, so callers can cache by map tile: a route through an
// area already fetched needs no call at all, and only the new tiles are asked for.
export default defineEndpoint({
  description: "Traffic lights, stop signs and yield signs from OpenStreetMap inside one or more boxes.",
  input: z.object({
    boxes: z.array(box).min(1).max(400),
  }),
  output: z.object({
    controls: z.array(control),
  }),
  example: { boxes: [[32.95, -96.9, 32.96, -96.89]] },
  source: "https://overpass-api.de/",
  async run(ctx, { boxes }) {
    const result = await raceOverpass(ctx, "data=" + encodeURIComponent(buildQuery(boxes)));

    const seen = new Set<number>();
    const controls: z.infer<typeof control>[] = [];
    for (const el of result.elements ?? []) {
      if (el.type !== "node" || seen.has(el.id)) continue;
      const kind = classify(el.tags ?? {});
      if (!kind) continue;
      seen.add(el.id);
      controls.push({ id: el.id, lat: el.lat, lon: el.lon, kind, direction: el.tags?.direction ?? null });
    }
    return { controls };
  },
});
