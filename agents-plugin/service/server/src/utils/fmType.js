export const UVL = 'UVL';
export const XML = 'XML';

export const fmType = (v) => {
  if (v == null) return UVL;
  const t = String(v).toUpperCase();
  if (t === UVL || t === XML) return t;
  throw new TypeError(`Tipo de feature model desconocido: "${v}". Debe ser "UVL" o "XML".`);
};
