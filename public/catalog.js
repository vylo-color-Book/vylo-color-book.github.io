export const PACKAGES = Object.freeze({
  book24: { label: 'كتاب 24 صفحة', price: 349, children: ['اسم الطفل'] },
  bundle: { label: 'كتابين 24 صفحة + كتاب 24 صفحة هدية', price: 698, children: ['اسم الطفل للكتاب الأول — 24 صفحة', 'اسم الطفل للكتاب الثاني — 24 صفحة', 'اسم الطفل لكتاب الهدية — 24 صفحة'] }
});
export const SHIPPING = 70;
export const DEPOSIT = 100;
export const WHATSAPP = '201270366874';
export const GOVERNORATES = Object.freeze(['القاهرة','الجيزة','الإسكندرية','القليوبية','المنوفية','الشرقية','الغربية','الدقهلية','البحيرة','كفر الشيخ','دمياط','بورسعيد','الإسماعيلية','السويس','مطروح','الفيوم','بني سويف','المنيا','أسيوط','سوهاج','قنا','الأقصر','أسوان','البحر الأحمر','الوادي الجديد','شمال سيناء','جنوب سيناء']);
export function normalizePhone(value) {
  let n = String(value ?? '').replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[\s()+-]/g, '');
  if (n.startsWith('0020')) n = n.slice(4);
  else if (n.startsWith('20')) n = n.slice(2);
  if (/^1[0125]\d{8}$/.test(n)) n = '0' + n;
  return /^01[0125]\d{8}$/.test(n) ? n : null;
}
