import { describe, expect, it } from "vitest";
import controls, { buildQuery } from "../catalog/openstreetmap.org/traffic-controls.ts";
import { Context, invoke } from "sitescrape";

const overpass = {
  elements: [
    { type: "node", id: 1, lat: 32.95, lon: -96.89, tags: { highway: "traffic_signals" } },
    { type: "node", id: 2, lat: 32.951, lon: -96.89, tags: { highway: "stop", stop: "all" } },
    { type: "node", id: 3, lat: 32.952, lon: -96.89, tags: { highway: "stop", direction: "forward" } },
    { type: "node", id: 4, lat: 32.953, lon: -96.89, tags: { highway: "give_way" } },
    { type: "node", id: 5, lat: 32.954, lon: -96.89, tags: { highway: "crossing" } },
    { type: "node", id: 1, lat: 32.95, lon: -96.89, tags: { highway: "traffic_signals" } },
  ],
};

function overpassContext(responses: Response[]) {
  const calls: { url: string; body: string }[] = [];
  const ctx = new Context({
    retries: 0,
    fetch: async (url, init) => {
      calls.push({ url, body: init?.body as string });
      return responses.shift() ?? new Response("", { status: 500 });
    },
  });
  return { ctx, calls };
}

describe("openstreetmap.org/traffic-controls", () => {
  it("asks for every box in one query", () => {
    const query = buildQuery([
      [32.95, -96.9, 32.96, -96.89],
      [32.96, -96.9, 32.97, -96.89],
    ]);
    expect(query.match(/\(32\.9\d,-96\.9,32\.9\d,-96\.89\)/g)).toHaveLength(2);
  });

  it("maps signals, stops and yields and drops everything else", async () => {
    const { ctx, calls } = overpassContext([new Response(JSON.stringify(overpass))]);
    const out = (await invoke(controls, ctx, { boxes: [[32.95, -96.9, 32.96, -96.89]] })) as any;

    expect(out.controls.map((c: any) => [c.id, c.kind, c.direction])).toEqual([
      [1, "signal", null],
      [2, "all_way_stop", null],
      [3, "stop", "forward"],
      [4, "give_way", null],
    ]);
    expect(decodeURIComponent(calls[0]!.body)).toContain("(32.95,-96.9,32.96,-96.89)");
  });

  it("uses whichever Overpass instance answers well", async () => {
    const { ctx, calls } = overpassContext([
      new Response("busy", { status: 429 }),
      new Response(JSON.stringify({ elements: [], remark: "runtime error: Query timed out" })),
      new Response(JSON.stringify(overpass)),
      new Response("busy", { status: 504 }),
    ]);
    const out = (await invoke(controls, ctx, { boxes: [[32.95, -96.9, 32.96, -96.89]] })) as any;
    expect(out.controls).toHaveLength(4);
    expect(calls).toHaveLength(4);
  });

  it("reports upstream when every instance fails", async () => {
    const { ctx } = overpassContext([]);
    await expect(invoke(controls, ctx, { boxes: [[32.95, -96.9, 32.96, -96.89]] })).rejects.toMatchObject({ code: "upstream" });
  });

  it("rejects a box that is upside down or too big", async () => {
    const { ctx } = overpassContext([]);
    await expect(invoke(controls, ctx, { boxes: [[32.96, -96.9, 32.95, -96.89]] })).rejects.toMatchObject({ code: "bad_input" });
    await expect(invoke(controls, ctx, { boxes: [[30, -98, 33, -95]] })).rejects.toMatchObject({ code: "bad_input" });
  });
});
