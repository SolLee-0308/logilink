import { PageHeader } from "@/components/layout/PageHeader";
import { NoteBox } from "@/components/ui/NoteBox";

/** 메뉴가 숨겨진 화면에 주소로 직접 들어온 경우 */
export function Forbidden({ title, crumbs = ["관리", "기준정보", title] }: { title: string; crumbs?: string[] }) {
  return (
    <>
      <PageHeader crumbs={crumbs} title={title} />
      <NoteBox tone="error">이 화면을 볼 권한이 없습니다.</NoteBox>
    </>
  );
}
