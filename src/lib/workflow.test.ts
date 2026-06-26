import { describe, expect, it } from "vitest";
import { acceptRevision, rejectRevision, setProposedRevision } from "./workflow";
import { createEmptyProject } from "./project";

describe("revision workflow", () => {
  it("keeps AI revisions pending until the user accepts them", () => {
    const project = createEmptyProject();
    project.currentCode = "cube(10);";

    const withProposal = setProposedRevision(project, "sphere(10);", {
      summary: "Cube should be rounded",
      issues: ["Original request asked for rounded geometry"],
      correctionPrompt: "Round the cube while preserving its original size.",
      confidence: 0.82
    });

    expect(withProposal.currentCode).toBe("cube(10);");
    expect(withProposal.proposedCode).toBe("sphere(10);");

    const accepted = acceptRevision(withProposal);

    expect(accepted.currentCode).toBe("sphere(10);");
    expect(accepted.proposedCode).toBe("");
    expect(accepted.iterations.at(-1)?.status).toBe("accepted");
  });

  it("can reject a pending revision without changing current code", () => {
    const project = setProposedRevision(createEmptyProject(), "sphere(10);", {
      summary: "Change shape",
      issues: [],
      correctionPrompt: "Change the shape according to the visual review.",
      confidence: 0.5
    });
    project.currentCode = "cube(10);";

    const rejected = rejectRevision(project);

    expect(rejected.currentCode).toBe("cube(10);");
    expect(rejected.proposedCode).toBe("");
    expect(rejected.iterations.at(-1)?.status).toBe("rejected");
  });
});
