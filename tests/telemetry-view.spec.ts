import { describe, expect, it } from "vitest";
import { createNewtonSeconds, createNonEmptyText } from "../src/core/contracts.js";
import { renderTelemetryBadgeHtml } from "../src/ui/telemetry-view.js";

describe("Telemetry UI Formatter (Renderer Safe Tier 0)", () => {
  it("renders valid HTML with mission name and formatted impulse", () => {
    const mission = createNonEmptyText("Mars Reconnaissance II");
    const impulse = createNewtonSeconds(1234.5);

    expect(mission.ok && impulse.ok).toBe(true);
    if (!mission.ok || !impulse.ok) return;

    const html = renderTelemetryBadgeHtml({
      missionName: mission.value,
      totalImpulseNs: impulse.value,
      status: "NOMINAL"
    });

    expect(html).toContain('data-status="NOMINAL"');
    expect(html).toContain("Mars Reconnaissance II");
    expect(html).toContain("1234.50 N·s");
  });
});
