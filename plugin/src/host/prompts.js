import { MAX_CHUNK_CHARS, MAX_CHUNKS, MAX_QUESTION_CHARS } from './constants.js';

export function normalizeChunks(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((chunk) => chunk && typeof chunk === 'object')
    .slice(0, MAX_CHUNKS)
    .map((chunk, index) => ({
      label: String(chunk.label || `P${index + 1}`).slice(0, 40),
      page: String(chunk.page || '').slice(0, 20),
      text: String(chunk.text || '').slice(0, MAX_CHUNK_CHARS),
    }))
    .filter((chunk) => chunk.text.trim());
}

export function buildMessages({ kind, question, itemTitle, chunks }) {
  const q = String(question || '').trim().slice(0, MAX_QUESTION_CHARS);
  const context = normalizeChunks(chunks)
    .map((chunk) => `[${chunk.label}]${chunk.page ? `（第 ${chunk.page} 页）` : ''}\n${chunk.text}`)
    .join('\n\n');

  const system = kind === 'case'
    ? [
        '你是严谨的医学病例整理助手，服务医生、药企医学人员与科研人员。',
        '只能整理用户提供的信息；不得补写未提供的症状、体征、检查、病史或用药。',
        '先列出已提供的信息结构与缺口，再指出互相矛盾或需要澄清的点，最后围绕用户列出的问题给出循证讨论框架。',
        '不得声称已查询最新指南或数据库；不得编造页码、DOI、指南年份或药物剂量；不得给出面向具体患者的处方或处置指令。',
        '用简体中文，结构清晰，控制在 700 字以内。',
      ].join('\n')
    : [
        '你是严谨的医学文献阅读助手，服务医生、药企医学人员与科研人员。',
        '只能使用用户提供的「原文片段」作答；片段之外的信息一律视为未知。',
        '每个关键结论后用 [P1] 这样的片段编号标注出处；无法从片段确认时明确写“已读取内容中未找到”，不得猜测。',
        '不得编造页码、引文、PMID、DOI、指南年份或药物剂量；不得给出面向具体患者的诊疗指令。',
        '用简体中文，先给结论，再给依据与局限，控制在 600 字以内。',
        kind === 'explain'
          ? '用户要求解释选中的段落：先用通俗中文解释术语与逻辑，再说明该段落在论文论证中的作用。'
          : '用户在就该论文提问：直接回答问题，并列出支撑片段。',
      ].join('\n');

  const user = [
    `论文/病例标题：${String(itemTitle || '（未提供）').slice(0, 300)}`,
    '',
    kind === 'case' ? '用户提供的病例信息：' : '原文片段：',
    context || '（无可用片段）',
    '',
    `问题：${q || '（未提供）'}`,
  ].join('\n');

  return { system, user, chunks: normalizeChunks(chunks), question: q };
}
