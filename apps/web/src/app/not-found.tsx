import { FileQuestion } from "lucide-react";
import { ButtonLink, EmptyState } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <EmptyState icon={<FileQuestion />} title="Not found" action={<ButtonLink href="/investigations">All investigations</ButtonLink>}>
      Nothing on disk matches this address. Run directories may have been deleted, or the id is wrong.
    </EmptyState>
  );
}
