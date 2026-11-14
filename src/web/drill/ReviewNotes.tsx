import type { ReactNode } from "react";
import { ERROR_TYPE_INFO } from "../../engine/drillSchema";
import type { Annotation, AnnotationKind } from "../../shared/api";
import { cx } from "../ui";

/** How each outcome is drawn: in the document (mark) and in the note under it (tone, title). */
export const KIND_STYLE: Readonly<Record<AnnotationKind, { mark: string; tone: string; label: string }>> = {
  caught: {
    mark: "bg-caught-soft underline decoration-caught decoration-2 underline-offset-4",
    tone: "border-caught/40 bg-caught-soft",
    label: "text-caught-deep",
  },
  wrong_type: {
    mark: "bg-partial-soft underline decoration-partial decoration-2 underline-offset-4",
    tone: "border-partial/40 bg-partial-soft",
    label: "text-partial-deep",
  },
  missed: {
    mark: "bg-overrule-soft outline outline-2 outline-overrule",
    tone: "border-overrule/40 bg-overrule-soft",
    label: "text-overrule-deep",
  },
  false_flag: {
    mark: "bg-paper-2 underline decoration-ink decoration-2 decoration-dashed underline-offset-4",
    tone: "border-line-strong bg-paper-2",
    label: "text-ink",
  },
  decoy_flagged: {
    mark: "bg-paper-2 underline decoration-ink decoration-2 decoration-dashed underline-offset-4",
    tone: "border-line-strong bg-paper-2",
    label: "text-ink",
  },
  decoy_avoided: {
    mark: "underline decoration-caught decoration-dotted decoration-2 underline-offset-4",
    tone: "border-line bg-card",
    label: "text-caught-deep",
  },
};

const WHY_VERDICT: Readonly<Record<0 | 1 | 2, string>> = { 2: "on point", 1: "partly there", 0: "missed the point" };

function typeName(type: Annotation["keyType"]): string {
  return type ? ERROR_TYPE_INFO[type].label : "";
}

function title(a: Annotation): string {
  switch (a.kind) {
    case "caught":
      return `Caught · ${typeName(a.keyType)}`;
    case "wrong_type":
      return `Caught — but this is a ${typeName(a.keyType)} mistake, not ${typeName(a.flaggedType)}`;
    case "missed":
      return `Missed · ${typeName(a.keyType)}`;
    case "false_flag":
      return "False alarm — this line was fine";
    case "decoy_flagged":
      return "This was correct";
    case "decoy_avoided":
      return "Good restraint";
  }
}

function body(a: Annotation): ReactNode {
  switch (a.kind) {
    case "caught":
    case "wrong_type":
    case "missed":
      return (
        <>
          <p>{a.explanation}</p>
          {a.correction && (
            <p className="mt-1.5">
              <span className="font-medium">Fix:</span> {a.correction}
            </p>
          )}
          {a.why && a.whyScore !== undefined && (
            <p className="mt-1.5 text-ink-2">
              Your reasoning — “{a.why}” — <span className="font-medium">{WHY_VERDICT[a.whyScore]}</span>.
            </p>
          )}
        </>
      );
    case "false_flag":
      return <p>Over-flagging costs your team time.</p>;
    case "decoy_flagged":
      return (
        <p>
          It looks wrong because {lowerFirst(a.looksWrongBecause)} — but {lowerFirst(a.fineBecause)}
        </p>
      );
    case "decoy_avoided":
      return <p>This only looked wrong. {a.fineBecause}</p>;
  }
}

function lowerFirst(text: string | undefined): string {
  if (!text) return "";
  return text.charAt(0).toLowerCase() + text.slice(1).replace(/\.$/, "");
}

/** The review notes for one block of the document, shown right under it. */
export function ReviewNotes({ annotations, quotes }: { annotations: ReadonlyArray<Annotation>; quotes: ReadonlyMap<string, string> }) {
  if (annotations.length === 0) return null;
  return (
    <ul className="space-y-2">
      {annotations.map((a) => (
        <li key={a.targetId} className={cx("rounded-xl border px-3.5 py-3 text-[0.9rem] leading-relaxed", KIND_STYLE[a.kind].tone)}>
          <p className={cx("font-semibold", KIND_STYLE[a.kind].label)}>{title(a)}</p>
          <p className="mt-0.5 text-ink-3">“{quotes.get(a.targetId)}”</p>
          <div className="mt-1.5">{body(a)}</div>
        </li>
      ))}
    </ul>
  );
}
