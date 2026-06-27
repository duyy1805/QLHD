import { redirect } from "next/navigation";

export default async function EditPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  redirect(`/documents/${type}/${id}`);
}
