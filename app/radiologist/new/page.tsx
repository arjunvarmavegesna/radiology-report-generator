import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { NewCaseForm } from "@/components/new-case-form";

export default function NewCasePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>New Case</CardTitle>
        <CardDescription>
          Enter patient details and the radiologist&apos;s shorthand findings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <NewCaseForm />
      </CardContent>
    </Card>
  );
}
