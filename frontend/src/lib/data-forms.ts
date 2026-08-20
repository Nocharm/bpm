// 데이터 폼(자료 형식) 카탈로그 — IO 항목별 형식 자동완성의 단일 소스.
// 확장자/영문 프로그램명/한글명 어느 쪽으로 검색해도 매치(lib/search 유사도 랭킹 재사용).
// 저장 canonical: 인터뷰 레거시 3종(structured/document/tacit)은 소문자 유지, 프로그램형은 영문명.
import {
  BookText,
  Brain,
  Database,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Mail,
  PenLine,
  Presentation,
  Server,
  Table,
  type LucideIcon,
} from "lucide-react";

import { filterByQuery, type FieldSpec } from "@/lib/search";

export interface DataFormOption {
  // 저장 canonical 값 — Node.input_forms 줄에 이대로 기록
  value: string;
  // 검색어(확장자·영문·한글·별칭) — 첫 항목부터 매치 우선순위(필드 순서 랭킹)
  keywords: string[];
  icon: LucideIcon;
}

export const DATA_FORM_OPTIONS: DataFormOption[] = [
  { value: "structured", keywords: ["structured", "정형", "정형 데이터", "시스템 데이터"], icon: Database },
  { value: "document", keywords: ["document", "문서", "도큐먼트"], icon: BookText },
  { value: "tacit", keywords: ["tacit", "암묵지", "구두", "경험"], icon: Brain },
  { value: "Excel", keywords: [".xlsx", "excel", "엑셀", ".xls"], icon: FileSpreadsheet },
  { value: "Word", keywords: [".docx", "word", "워드", ".doc"], icon: FileText },
  { value: "PowerPoint", keywords: [".pptx", "powerpoint", "파워포인트", "피피티", ".ppt"], icon: Presentation },
  { value: "PDF", keywords: [".pdf", "pdf", "피디에프"], icon: File },
  { value: "CSV", keywords: [".csv", "csv", "씨에스브이"], icon: Table },
  { value: "Email", keywords: [".eml", "email", "mail", "이메일", "메일"], icon: Mail },
  { value: "Paper", keywords: ["paper", "종이", "수기", "서면", "출력물"], icon: PenLine },
  { value: "Image", keywords: [".png", ".jpg", "image", "이미지", "사진", "스캔"], icon: FileImage },
  { value: "System", keywords: ["system", "시스템", "전산", "sap", "erp"], icon: Server },
];

/** 저장값 → 카탈로그 항목 — canonical/확장자/별칭 대소문자 무시 매치. 미지(기타)면 null(아이콘 없음). */
export function resolveDataForm(raw: string): DataFormOption | null {
  const needle = raw.trim().toLowerCase();
  if (needle === "") return null;
  return (
    DATA_FORM_OPTIONS.find(
      (o) => o.value.toLowerCase() === needle || o.keywords.some((k) => k.toLowerCase() === needle),
    ) ?? null
  );
}

/** 자동완성 후보 — 유사도 랭킹(부분일치·초성·로마자, filterByQuery). 빈 질의는 전체. */
export function searchDataForms(query: string): DataFormOption[] {
  const toFields = (o: DataFormOption): FieldSpec[] => [
    { field: "value", text: o.value },
    ...o.keywords.map((k, i) => ({ field: `k${i}`, text: k })),
  ];
  return filterByQuery(DATA_FORM_OPTIONS, query, toFields).map((hit) => hit.item);
}

/** 입력값이 카탈로그와 정확히 일치하면 canonical로 정규화, 아니면 null(기타 — "추가" 행 필요). */
export function matchExactDataForm(raw: string): string | null {
  return resolveDataForm(raw)?.value ?? null;
}
