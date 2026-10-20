import { PROCESS_STEPS } from "../lib/constants";
import DetailSheet from "./DetailSheet";
import StageDetailBody from "./StageDetailBody";

export default function StageDetailSheet({ step, onClose, actions = null }) {
  const def = PROCESS_STEPS.find((s) => s.key === step?.key) || {};
  const live = step || {};
  const title = live.title || def.title || "Stage";

  return (
    <DetailSheet
      open={Boolean(step)}
      onClose={onClose}
      title={title}
      eyebrow={def.role || "Stage"}
      glyph={def.glyph || live.glyph || "●"}
      actions={actions}
      labelledBy="stage-sheet-title"
    >
      <StageDetailBody step={step} />
    </DetailSheet>
  );
}
