"use client";

import { useParams } from "next/navigation";
import { ReviewWorkspace } from "@/components/review-workspace";

/** Deep-link / back-compat: render the two-pane review with this case
 *  pre-selected. */
export default function ReviewDetailPage() {
  const params = useParams<{ caseId: string }>();
  return <ReviewWorkspace initialCaseId={params.caseId} />;
}
