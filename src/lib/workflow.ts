import type { ProjectState, VisionReview } from "./project";

function cloneWithUpdate(project: ProjectState): ProjectState {
  return {
    ...project,
    views: { ...project.views },
    iterations: [...project.iterations],
    updatedAt: new Date().toISOString()
  };
}

export function setProposedRevision(
  project: ProjectState,
  proposedCode: string,
  review: VisionReview
): ProjectState {
  const next = cloneWithUpdate(project);
  next.proposedCode = proposedCode;
  next.review = review;
  next.iterations.push({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    requirement: next.requirement,
    code: next.currentCode,
    modelId: next.codeModelId,
    status: "reviewed",
    reviewSummary: review.summary
  });
  return next;
}

export function acceptRevision(project: ProjectState): ProjectState {
  const next = cloneWithUpdate(project);
  if (!next.proposedCode.trim()) {
    return next;
  }
  next.currentCode = next.proposedCode;
  next.proposedCode = "";
  next.iterations.push({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    requirement: next.requirement,
    code: next.currentCode,
    modelId: next.codeModelId,
    status: "accepted",
    reviewSummary: next.review?.summary
  });
  return next;
}

export function rejectRevision(project: ProjectState): ProjectState {
  const next = cloneWithUpdate(project);
  next.proposedCode = "";
  next.iterations.push({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    requirement: next.requirement,
    code: next.currentCode,
    modelId: next.codeModelId,
    status: "rejected",
    reviewSummary: next.review?.summary
  });
  return next;
}
