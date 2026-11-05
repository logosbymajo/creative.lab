// Planes de CREATIVE.LAB (precios en pesos colombianos)
export const PLANES: Record<string, { nombre: string; precio: number; videos: number }> = {
  basico: { nombre: "Básico", precio: 119900, videos: 20 },
  pro: { nombre: "Pro", precio: 149900, videos: 50 },
  premium: { nombre: "Premium", precio: 349900, videos: 100 },
};
// Paquete extra: videos adicionales solo para el mes en curso
export const EXTRA = { nombre: "Paquete +10 videos", precio: 49900, videos: 10 };
