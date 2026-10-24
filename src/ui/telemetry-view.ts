import type { TelemetryReadoutViewModel } from "../core/contracts.js";

export function renderTelemetryBadgeHtml(viewModel: TelemetryReadoutViewModel): string {
  const formattedImpulse = viewModel.totalImpulseNs.toFixed(2);
  return `<section id="telemetry-view-root"><span class="status-badge" data-status="${viewModel.status}">${viewModel.missionName}</span><output data-testid="impulse-ns-readout">${formattedImpulse} N·s</output></section>`;
}


