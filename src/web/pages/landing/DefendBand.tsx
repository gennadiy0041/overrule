import { REHEARSAL_PACK } from "../../../shared/pricing";
import { ButtonLink } from "../../ui";
import { Section } from "./Section";

/** The reason to open Overrule before a real deadline: rehearse the questions about your own document. */
export function DefendBand() {
  return (
    <Section title="Before you hit send" lede="Defend your work">
      <p className="max-w-2xl text-xl leading-relaxed">
        “Where does this number come from?” If AI drafted the report, you may not know. Paste it in and rehearse the
        five questions your reader will ask — each one about a line in your own text — then see which of your answers
        hold.
      </p>
      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <ButtonLink to="/defend" variant="dark" size="lg" className="w-full sm:w-auto">
          Rehearse a document
        </ButtonLink>
        <p className="text-sm text-ink-3">
          The first rehearsal is free. Then {REHEARSAL_PACK.size} for ${REHEARSAL_PACK.price.toFixed(2)}, no
          subscription needed.
        </p>
      </div>
    </Section>
  );
}
