// Decide qué avisos toca mandar. Sin dependencias: se puede probar solo.
const TZ = "-04:00"; // República Dominicana (sin cambio de hora)
const DIAS = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
const hl = h => { const n = parseInt(h); return ((n % 12) || 12) + ":" + String(h).slice(3, 5) + " " + (n < 12 ? "AM" : "PM"); };
const diaTxt = d => DIAS[new Date(d + "T12:00:00" + TZ).getUTCDay()] + " " + d.slice(8, 10) + "/" + d.slice(5, 7);

// Devuelve una lista de { para: "cliente"|"barbero", set: {campos a marcar}, titulo, cuerpo }
// En el texto, "{n}" se cambia por el nombre del cliente.
function eventos(d, now, bn) {
  const out = [];
  if (!d || !d.cid || d.cid === "barbero" || d.bloqueo || d.estado === "bloqueada") return out;
  const t = Date.parse(d.dia + "T" + d.hora + ":00" + TZ);
  if (isNaN(t)) return out;
  const m = (t - now) / 60000, key = d.dia + " " + d.hora;
  const fresca = ts => !!ts && now - ts >= 0 && now - ts < 864e5; // ocurrió en las últimas 24 h
  const cuando = diaTxt(d.dia) + " a las " + hl(d.hora);
  // Si hay varios barberos, se dice con cuál es la cita (el principal es "peluca")
  const con = (bn && d.bid && d.bid !== "peluca" && bn[d.bid]) ? " · con " + bn[d.bid] : "";

  if (d.estado === "activa") {
    if (m > 0 && m <= 40) {
      if (d.n30 !== key) {
        const min = Math.max(5, Math.round(m / 5) * 5);
        out.push({ para: "cliente", set: { n30: key, n2h: key }, titulo: "Tu cita es en " + min + " minutos ⏰",
          cuerpo: d.servicio + con + " a las " + hl(d.hora) + ". Llega 10 minutos antes, ¡te esperamos!" });
      }
    } else if (m > 40 && m <= 120) {
      if (d.n2h !== key) out.push({ para: "cliente", set: { n2h: key }, titulo: "Tu cita se acerca ✂️",
        cuerpo: "Hoy a las " + hl(d.hora) + " · " + d.servicio + con + ". Recuerda llegar 10 minutos antes." });
    }
    if (d.deEspera && !d.ne && fresca(d.creada)) out.push({ para: "cliente", set: { ne: true }, titulo: "¡Se liberó un turno para ti! 🎉",
      cuerpo: "Tu cita de " + d.servicio + " quedó para el " + cuando + ". Si no puedes ir, cancélala en la app." });
    if (!d.nb && fresca(d.creada) && !d.deEspera) out.push({ para: "barbero", set: { nb: true }, titulo: "Nueva cita 📅",
      cuerpo: "{n} · " + d.servicio + " · " + cuando + con });
  }
  if (d.estado === "cancelada") {
    if (d.por === "barbero") {
      if (fresca(d.canceladaEn) && d.nc !== d.canceladaEn) out.push({ para: "cliente", set: { nc: d.canceladaEn },
        titulo: "Tu cita fue cancelada", cuerpo: "Tu cita del " + cuando + " fue cancelada por el tatuador. Entra a la app para reservar otra hora." });
    } else if (fresca(d.canceladaEn) && d.nbc !== d.canceladaEn) {
      out.push({ para: "barbero", set: { nbc: d.canceladaEn }, titulo: "Cita cancelada",
        cuerpo: "{n} canceló su cita del " + cuando + con + (d.motivo ? ". Motivo: " + d.motivo : "") + "." + (d.esp === "pend" ? " ¿Quieres ofrecer ese turno a la lista de espera? Abre la app." : "") });
    }
  }
  if (d.prop && d.prop.dia && d.prop.hora && fresca(d.propEn) && d.np !== d.propEn) {
    out.push({ para: "cliente", set: { np: d.propEn }, titulo: "El tatuador te propone otra hora",
      cuerpo: "Quiere mover tu cita al " + diaTxt(d.prop.dia) + " a las " + hl(d.prop.hora) + ". Entra a Mis citas para aceptar o rechazar." });
  }
  return out;
}
// Estado de una persona en la lista de espera: "espera" | "agenda" (hay que pedirle que agende para mañana) | "fuera" (se quita)
function esperaEstado(e, now, susReservas) {
  const fin1 = Date.parse(e.dia + "T19:00:00" + TZ), vence = Date.parse(e.dia + "T23:59:59" + TZ) + 864e5;
  if (now > vence) return "fuera";
  if ((susReservas || []).some(r => r.estado === "activa" && (r.creada || 0) > e.creada && Date.parse(r.dia + "T" + r.hora + ":00" + TZ) > now)) return "fuera";
  return now > fin1 ? "agenda" : "espera";
}
// Resumen de la mañana para el barbero: cuántas citas tiene hoy (y con quién, si hay varios barberos)
function resumen(reservas, hoy, bn) {
  const act = reservas.filter(d => d && d.estado === "activa" && d.dia === hoy && d.cid && d.cid !== "barbero" && !d.bloqueo);
  if (!act.length) return { titulo: "Hoy no tienes citas", cuerpo: "Todavía no hay citas agendadas para hoy." };
  act.sort((a, b) => (a.hora < b.hora ? -1 : 1));
  const por = {}; act.forEach(d => { const id = d.bid || "peluca"; por[id] = (por[id] || 0) + 1; });
  const ids = Object.keys(por);
  const det = ids.length > 1 ? " (" + ids.map(id => ((bn && bn[id]) || "Tatuador") + " " + por[id]).join(", ") + ")" : "";
  return { titulo: "Tu agenda de hoy ✂️", cuerpo: act.length + (act.length === 1 ? " cita" : " citas") + " hoy" + det + ". La primera es a las " + hl(act[0].hora) + "." };
}
// Fila pública de disponibilidad (misma regla que usa la app): sin nombre, servicio ni precio
function dispKey(r) { return r.dia + "_" + String(r.hora).replace(":", "") + "_" + (r.bid || "peluca"); }
function dispRow(r, id, now) {
  const b = { dia: r.dia, hora: r.hora, bid: r.bid || "peluca", cid: r.cid, rid: id };
  if (r.estado === "activa") return { ...b, estado: "activa" };
  if (r.estado === "bloqueada" || (r.estado === "cancelada" && r.bloqueo)) return { ...b, estado: "bloqueada" };
  if (r.estado === "cancelada" && r.esp === "pend" && !r.bloqueo && now - (r.canceladaEn || 0) < 108e5)
    return { ...b, estado: "cancelada", esp: "pend", canceladaEn: r.canceladaEn || now };
  return null;
}
module.exports = { eventos, esperaEstado, resumen, dispKey, dispRow, hl, diaTxt, TZ };
