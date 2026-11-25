import { lockSequence, type Tx } from '../../common/prisma/tenant-tx';

/** Next human-readable invoice code (HD00001…) inside the caller's transaction. */
export async function nextInvoiceCode(db: Tx, tenantId: string): Promise<string> {
  await lockSequence(db, tenantId, 'invoice-code');
  const last = await db.invoice.findFirst({ where: { tenantId, code: { startsWith: 'HD' } }, orderBy: { code: 'desc' }, select: { code: true } });
  const n = last ? Number(last.code.replace(/\D/g, '')) || 0 : 0;
  return `HD${String(n + 1).padStart(5, '0')}`;
}

export function invoiceStatus(amount: bigint, discount: bigint, paid: bigint): 'UNPAID' | 'PARTIAL' | 'PAID' {
  if (paid <= 0n) return 'UNPAID';
  return paid >= amount - discount ? 'PAID' : 'PARTIAL';
}
