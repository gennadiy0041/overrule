import { Fragment, type ReactNode } from "react";
import type { Block, PublicDrill, Segment } from "../../engine/drillSchema";
import { cx } from "../ui";

/** Where a target sits: inline in running text, or filling a table cell. */
export type TargetPlace = "inline" | "cell";

interface Props {
  drill: PublicDrill;
  /** Render one flaggable unit (a sentence, a heading, a bullet or a table cell). */
  target: (segment: Segment, place: TargetPlace) => ReactNode;
  /** Optional content placed right under a block — the result page hangs its review notes here. */
  after?: (targetIds: ReadonlyArray<string>) => ReactNode;
}

const KIND_LABEL: Readonly<Record<PublicDrill["artifact"]["kind"], string>> = {
  email: "Email",
  reply: "Reply",
  report: "Report",
  summary: "Summary",
  policy: "Policy",
  plan: "Plan",
};

function isNumeric(text: string): boolean {
  return /^[\s$€£(+\-−]*\d[\d,.\s]*[%x)kKmM]*\s*$/.test(text);
}

function blockTargetIds(block: Block): string[] {
  return block.type === "text" ? block.segments.map((s) => s.id) : block.rows.flat().map((cell) => cell.id);
}

function TextBlock({ block, target }: { block: Extract<Block, { type: "text" }>; target: Props["target"] }) {
  const inline = block.segments.map((segment, index) => (
    <Fragment key={segment.id}>
      {index > 0 && " "}
      {target(segment, "inline")}
    </Fragment>
  ));
  if (block.style === "heading") return <h3 className="mt-5 text-lg first:mt-0">{inline}</h3>;
  if (block.style === "subject") return <p className="font-semibold">{inline}</p>;
  if (block.style === "bullet") {
    return (
      <ul className="list-disc space-y-1.5 pl-5 marker:text-ink-3">
        {block.segments.map((segment) => (
          <li key={segment.id}>{target(segment, "inline")}</li>
        ))}
      </ul>
    );
  }
  return <p>{inline}</p>;
}

function TableBlock({ block, target }: { block: Extract<Block, { type: "table" }>; target: Props["target"] }) {
  return (
    // The table scrolls inside itself on a narrow phone; the page never does.
    <div className="-mx-1 overflow-x-auto">
      <table className="tabular w-full border-collapse text-[0.9rem]">
        <thead>
          <tr className="border-b border-line-strong text-left text-xs text-ink-3">
            {block.columns.map((column, index) => (
              <th key={column} className={cx("px-1.5 py-1.5 font-medium", index > 0 && "text-right")}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b hairline last:border-0">
              {row.map((cell, index) => (
                <td key={cell.id} className={cx("p-0.5", index > 0 && isNumeric(cell.text) && "text-right")}>
                  {target(cell, "cell")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders a drill's document so it reads like the real thing — a mail client for
 * emails and replies, a page for reports and plans — not like a quiz. The drill
 * page and the result page share it and differ only in how a target is drawn.
 */
export function ArtifactView({ drill, target, after }: Props) {
  const { artifact, brief } = drill;
  const mail = artifact.kind === "email" || artifact.kind === "reply";
  // Some drafts open with their own subject line; showing it twice would look like a planted mistake.
  const hasSubjectLine = artifact.blocks.some((block) => block.type === "text" && block.style === "subject");

  return (
    <article className="rounded-card border hairline bg-card shadow-card">
      {mail ? (
        <header className="space-y-1 border-b hairline px-4 py-3 text-sm sm:px-5">
          <p className="flex gap-3">
            <span className="w-20 shrink-0 text-ink-3">Drafted by</span>
            <span>
              <span className="rounded bg-ink px-1.5 py-0.5 text-[0.7rem] font-semibold text-paper">AI</span> assistant
            </span>
          </p>
          <p className="flex gap-3">
            <span className="w-20 shrink-0 text-ink-3">For</span>
            <span>{brief.from}</span>
          </p>
          {!hasSubjectLine && (
            <p className="flex gap-3">
              <span className="w-20 shrink-0 text-ink-3">Subject</span>
              <span className="font-medium">{artifact.title}</span>
            </p>
          )}
        </header>
      ) : (
        <header className="border-b hairline px-4 py-4 sm:px-5">
          <p className="eyebrow">{KIND_LABEL[artifact.kind]} · AI assistant draft</p>
          <h2 className="mt-1.5 text-2xl leading-tight">{artifact.title}</h2>
        </header>
      )}
      <div className="space-y-3.5 px-4 py-4 leading-relaxed sm:px-5">
        {artifact.blocks.map((block, index) => (
          <Fragment key={index}>
            {block.type === "text" ? <TextBlock block={block} target={target} /> : <TableBlock block={block} target={target} />}
            {after?.(blockTargetIds(block))}
          </Fragment>
        ))}
      </div>
    </article>
  );
}
