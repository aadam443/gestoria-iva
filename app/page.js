'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ── COLORES ───────────────────────────────────────────────────────────────────
const C = {
  bg: '#0a0a0f', surface: '#111118', surfaceHover: '#1a1a24',
  border: '#1e1e2e', borderLight: '#2a2a3e',
  accent: '#6366f1', accentHover: '#818cf8', accentDim: 'rgba(99,102,241,0.12)',
  green: '#10b981', greenDim: 'rgba(16,185,129,0.12)',
  red: '#ef4444', redDim: 'rgba(239,68,68,0.12)',
  amber: '#f59e0b', amberDim: 'rgba(245,158,11,0.12)',
  blue: '#3b82f6', blueDim: 'rgba(59,130,246,0.12)',
  purple: '#a855f7', purpleDim: 'rgba(168,85,247,0.12)',
  text: '#f1f1f5', textMuted: '#6b7280', textDim: '#374151',
}

const TAG = {
  deducir:        { bg: 'rgba(16,185,129,0.12)',  color: '#10b981', label: 'deducible' },
  bloquear:       { bg: 'rgba(239,68,68,0.12)',   color: '#ef4444', label: 'bloqueado' },
  prorrata:       { bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b', label: 'prorrata' },
  isp:            { bg: 'rgba(168,85,247,0.12)',  color: '#a855f7', label: 'ISP' },
  intracomunitaria:{ bg: 'rgba(59,130,246,0.12)', color: '#3b82f6', label: 'intracomunitaria' },
}

// ── LLAMADA A N8N ─────────────────────────────────────────────────────────────
// Todas las llamadas al backend pasan por n8n
async function n8n(path, body = {}) {
  const base = process.env.NEXT_PUBLIC_N8N_BASE_URL
  if (!base) {
    console.warn('NEXT_PUBLIC_N8N_BASE_URL no configurado')
    return { error: 'N8N no configurado', data: null }
  }
  try {
    const res = await fetch(`${base}/webhook/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, timestamp: new Date().toISOString() })
    })
    const data = await res.json()
    return { data, error: null }
  } catch (e) {
    return { data: null, error: e.message }
  }
}

export default function Dashboard() {
  const [clientes, setClientes] = useState([])
  const [clienteActivo, setClienteActivo] = useState(null)
  const [tabActiva, setTabActiva] = useState('ficha')
  const [reglas, setReglas] = useState([])
  const [excepciones, setExcepciones] = useState([])
  const [facturas, setFacturas] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [mensaje, setMensaje] = useState(null)
  const [nuevaRegla, setNuevaRegla] = useState({ concepto: '', accion: 'deducir', porcentaje: 100, base_legal: '' })
  const [nuevaExcepcion, setNuevaExcepcion] = useState({ tipo: 'Importación puntual', proveedor: '', modelo_fiscal: 'ISP / Importación', descripcion: '' })

  const msg = useCallback((texto, tipo = 'ok') => {
    setMensaje({ texto, tipo })
    setTimeout(() => setMensaje(null), 4000)
  }, [])

  // ── CARGAR CLIENTES DESDE N8N ─────────────────────────────────────────────
  const cargarClientes = useCallback(async () => {
    setCargando(true)
    // Primero intenta n8n, si no hay URL cae a Supabase directo
    const base = process.env.NEXT_PUBLIC_N8N_BASE_URL
    if (base) {
      const { data, error } = await n8n('gestor/clientes', {})
      setCargando(false)
      if (error) { msg('Error cargando clientes desde n8n: ' + error, 'error'); return }
      setClientes(Array.isArray(data) ? data : data?.clientes || [])
    } else {
      // Fallback: Supabase directo
      const { data, error } = await supabase
        .from('clientes')
        .select('id, nombre, cif, regimen_iva, tiene_prorrata, prorrata_porcentaje, operaciones_intracomunitarias, email, rol')
        .order('nombre')
      setCargando(false)
      if (error) { msg('Error cargando clientes: ' + error.message, 'error'); return }
      setClientes(data || [])
    }
  }, [msg])

  // ── CARGAR REGLAS DESDE SUPABASE ──────────────────────────────────────────
  const cargarReglas = useCallback(async (clienteId) => {
    const { data, error } = await supabase
      .from('reglas_fiscales')
      .select('*')
      .eq('cliente_id', clienteId)
      .eq('activa', true)
      .order('concepto')
    if (error) { msg('Error cargando reglas: ' + error.message, 'error'); return }
    setReglas(data || [])
  }, [msg])

  // ── CARGAR EXCEPCIONES DESDE SUPABASE ─────────────────────────────────────
  const cargarExcepciones = useCallback(async (clienteId) => {
    const { data, error } = await supabase
      .from('excepciones_fiscales')
      .select('*')
      .eq('cliente_id', clienteId)
      .order('creado_en', { ascending: false })
    if (error) { msg('Error cargando excepciones: ' + error.message, 'error'); return }
    setExcepciones(data || [])
  }, [msg])

  // ── CARGAR FACTURAS DESDE N8N ─────────────────────────────────────────────
  const cargarFacturas = useCallback(async (cif) => {
    const { data, error } = await n8n(`gestor/clientes/${cif}/facturas`, {})
    if (error) { msg('Error cargando facturas: ' + error, 'error'); return }
    setFacturas(Array.isArray(data) ? data : data?.facturas || [])
  }, [msg])

  useEffect(() => { cargarClientes() }, [cargarClientes])

  async function seleccionarCliente(cliente) {
    setClienteActivo(cliente)
    setTabActiva('ficha')
    setReglas([])
    setExcepciones([])
    setFacturas([])
    await cargarReglas(cliente.id)
    await cargarExcepciones(cliente.id)
    await cargarFacturas(cliente.cif)
  }

  // ── GUARDAR FICHA → SUPABASE + NOTIFICA N8N ───────────────────────────────
  async function guardarFicha() {
    setGuardando(true)
    const { error } = await supabase
      .from('clientes')
      .update({
        regimen_iva: clienteActivo.regimen_iva,
        tiene_prorrata: clienteActivo.tiene_prorrata,
        prorrata_porcentaje: clienteActivo.prorrata_porcentaje,
        operaciones_intracomunitarias: clienteActivo.operaciones_intracomunitarias,
      })
      .eq('id', clienteActivo.id)
    setGuardando(false)
    if (error) { msg('Error guardando: ' + error.message, 'error'); return }
    // Notificar a n8n que recargue la config del cliente
    await n8n('gestor/clientes', { evento: 'cliente_actualizado', cliente_id: clienteActivo.id, cif: clienteActivo.cif })
    msg('Ficha guardada. n8n aplicará los cambios en la próxima factura.', 'ok')
  }

  // ── AÑADIR REGLA → SUPABASE + NOTIFICA N8N ───────────────────────────────
  async function añadirRegla() {
    if (!nuevaRegla.concepto) { msg('Escribe un concepto', 'error'); return }
    const { data, error } = await supabase
      .from('reglas_fiscales')
      .insert({
        cliente_id: clienteActivo.id,
        concepto: nuevaRegla.concepto,
        accion: nuevaRegla.accion,
        porcentaje: nuevaRegla.porcentaje,
        base_legal: nuevaRegla.base_legal || 'Criterio gestor'
      })
      .select()
    if (error) { msg('Error añadiendo regla: ' + error.message, 'error'); return }
    setReglas(prev => [...prev, data[0]])
    setNuevaRegla({ concepto: '', accion: 'deducir', porcentaje: 100, base_legal: '' })
    await n8n('gestor/clientes', { evento: 'regla_añadida', cliente_id: clienteActivo.id, regla: data[0] })
    msg('Regla añadida. n8n la aplicará desde ahora.', 'ok')
  }

  async function eliminarRegla(reglaId) {
    const { error } = await supabase
      .from('reglas_fiscales')
      .update({ activa: false })
      .eq('id', reglaId)
    if (error) { msg('Error eliminando regla', 'error'); return }
    setReglas(prev => prev.filter(r => r.id !== reglaId))
    msg('Regla desactivada', 'ok')
  }

  // ── GUARDAR EXCEPCIÓN → SUPABASE + NOTIFICA N8N ───────────────────────────
  async function guardarExcepcion() {
    if (!nuevaExcepcion.proveedor) { msg('Escribe el proveedor', 'error'); return }
    const { data, error } = await supabase
      .from('excepciones_fiscales')
      .insert({
        cliente_id: clienteActivo.id,
        tipo: nuevaExcepcion.tipo,
        proveedor: nuevaExcepcion.proveedor,
        modelo_fiscal: nuevaExcepcion.modelo_fiscal,
        descripcion: nuevaExcepcion.descripcion,
        estado: 'pendiente',
        detectada_automatica: false
      })
      .select()
    if (error) { msg('Error guardando excepción: ' + error.message, 'error'); return }
    setExcepciones(prev => [data[0], ...prev])
    setNuevaExcepcion({ tipo: 'Importación puntual', proveedor: '', modelo_fiscal: 'ISP / Importación', descripcion: '' })
    await n8n('gestor/clientes', { evento: 'excepcion_configurada', cliente_id: clienteActivo.id, excepcion: data[0] })
    msg('Excepción guardada. n8n la reconocerá cuando llegue la factura.', 'ok')
  }

  async function marcarRevisada(excepcionId) {
    const { error } = await supabase
      .from('excepciones_fiscales')
      .update({ estado: 'procesada' })
      .eq('id', excepcionId)
    if (error) { msg('Error actualizando excepción', 'error'); return }
    setExcepciones(prev => prev.map(e => e.id === excepcionId ? { ...e, estado: 'procesada' } : e))
    msg('Excepción marcada como revisada', 'ok')
  }

  async function solicitarInforme() {
    msg('Solicitando informe a n8n...', 'info')
    await n8n('gestor/clientes', {
      evento: 'generar_informe_mensual',
      cliente_id: clienteActivo.id,
      cif: clienteActivo.cif,
      nombre: clienteActivo.nombre,
      mes: new Date().toISOString().slice(0, 7)
    })
    msg('n8n está generando el informe PDF. Lo recibirás por email.', 'ok')
  }

  const clientesFiltrados = clientes.filter(c =>
    c.nombre?.toLowerCase().includes(busqueda.toLowerCase()) ||
    c.cif?.toLowerCase().includes(busqueda.toLowerCase()) ||
    c.email?.toLowerCase().includes(busqueda.toLowerCase())
  )
  const excPendientes = excepciones.filter(e => e.estado === 'pendiente')
  const excProcesadas = excepciones.filter(e => e.estado !== 'pendiente')
  const facturasPendientes = facturas.filter(f => f.estado === 'pendiente' || f.estado === 'revision')

  return (
    <div style={{ display: 'flex', height: '100vh', background: C.bg, color: C.text, fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif", fontSize: 13, overflow: 'hidden' }}>

      {/* ── SIDEBAR ── */}
      <div style={{ width: 240, minWidth: 240, background: C.surface, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 16px 14px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>⚖</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.3px' }}>FiscalOS</div>
              <div style={{ fontSize: 10, color: C.textMuted }}>Panel del gestor</div>
            </div>
          </div>
        </div>

        <div style={{ padding: '10px 10px', borderBottom: `1px solid ${C.border}` }}>
          <input
            placeholder="🔍 Buscar cliente..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            style={{ width: '100%', padding: '6px 10px', fontSize: 12, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {cargando && <div style={{ padding: '20px 16px', color: C.textMuted, fontSize: 12 }}>Cargando clientes...</div>}
          {!cargando && clientesFiltrados.length === 0 && (
            <div style={{ padding: '20px 16px', color: C.textMuted, fontSize: 12 }}>Sin clientes</div>
          )}
          {clientesFiltrados.map(c => {
            const activo = clienteActivo?.id === c.id
            return (
              <div key={c.id || c.cif} onClick={() => seleccionarCliente(c)} style={{
                padding: '9px 14px', cursor: 'pointer', margin: '2px 6px', borderRadius: 8,
                background: activo ? C.accentDim : 'transparent',
                borderLeft: activo ? `2px solid ${C.accent}` : '2px solid transparent',
              }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: activo ? C.accentHover : C.text }}>{c.nombre}</div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{c.cif} · {c.regimen_iva || 'general'}</div>
              </div>
            )
          })}
        </div>

        <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.textMuted }}>{clientes.length} clientes · n8n activo</div>
        </div>
      </div>

      {/* ── MAIN ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Topbar */}
        <div style={{ padding: '0 24px', height: 56, background: C.surface, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.3px' }}>{clienteActivo?.nombre || 'Selecciona un cliente'}</div>
            {clienteActivo && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>{clienteActivo.cif} · {clienteActivo.email || ''}</div>}
          </div>
          {clienteActivo && (
            <div style={{ display: 'flex', gap: 8 }}>
              {facturasPendientes.length > 0 && (
                <div style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600, background: C.amberDim, color: C.amber, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  ⚠ {facturasPendientes.length} factura{facturasPendientes.length > 1 ? 's' : ''} pendiente{facturasPendientes.length > 1 ? 's' : ''}
                </div>
              )}
              <button onClick={guardarFicha} disabled={guardando} style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, background: C.accent, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', opacity: guardando ? 0.6 : 1 }}>
                {guardando ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          )}
        </div>

        {/* Mensaje */}
        {mensaje && (
          <div style={{
            padding: '9px 24px', fontSize: 12, fontWeight: 500, flexShrink: 0,
            background: mensaje.tipo === 'ok' ? C.greenDim : mensaje.tipo === 'info' ? C.accentDim : C.redDim,
            color: mensaje.tipo === 'ok' ? C.green : mensaje.tipo === 'info' ? C.accent : C.red,
            borderBottom: `1px solid ${mensaje.tipo === 'ok' ? C.green : mensaje.tipo === 'info' ? C.accent : C.red}22`
          }}>{mensaje.texto}</div>
        )}

        {!clienteActivo ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: C.textMuted }}>
            <div style={{ fontSize: 42 }}>⚖</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Selecciona un cliente</div>
            <div style={{ fontSize: 12 }}>Elige un expediente fiscal del panel izquierdo</div>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div style={{ display: 'flex', background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '0 24px', flexShrink: 0 }}>
              {[
                { id: 'ficha', label: 'Ficha fiscal', icon: '◉' },
                { id: 'reglas', label: 'Reglas base', icon: '⚡' },
                { id: 'excepciones', label: `Excepciones${excPendientes.length > 0 ? ` · ${excPendientes.length}` : ''}`, icon: '⚠' },
                { id: 'facturas', label: `Facturas${facturasPendientes.length > 0 ? ` · ${facturasPendientes.length}` : ''}`, icon: '📄' },
                { id: 'informe', label: 'Informe', icon: '📋' },
              ].map(t => (
                <div key={t.id} onClick={() => setTabActiva(t.id)} style={{
                  padding: '14px 14px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                  borderBottom: tabActiva === t.id ? `2px solid ${C.accent}` : '2px solid transparent',
                  color: tabActiva === t.id ? C.accentHover : C.textMuted,
                  fontWeight: tabActiva === t.id ? 600 : 400, marginBottom: -1,
                }}>
                  <span style={{ fontSize: 11 }}>{t.icon}</span>{t.label}
                </div>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>

              {/* ── FICHA FISCAL ── */}
              {tabActiva === 'ficha' && (
                <div style={{ maxWidth: 780 }}>
                  <SecLabel>Identidad fiscal</SecLabel>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <DField label="Razón social"><input defaultValue={clienteActivo.nombre} style={inp} /></DField>
                    <DField label="CIF / NIF"><input defaultValue={clienteActivo.cif} style={inp} /></DField>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 24 }}>
                    <DField label="Email"><input defaultValue={clienteActivo.email || ''} style={inp} /></DField>
                    <DField label="Rol"><input defaultValue={clienteActivo.rol || ''} style={inp} /></DField>
                    <DField label="Régimen IVA">
                      <select value={clienteActivo.regimen_iva || 'general'} onChange={e => { const v = e.target.value; setClienteActivo(p => ({ ...p, regimen_iva: v })) }} style={inp}>
                        <option value="general">General</option>
                        <option value="exento">Exento</option>
                        <option value="simplificado">Simplificado</option>
                        <option value="recargo">Recargo equivalencia</option>
                        <option value="rebu">REBU</option>
                      </select>
                    </DField>
                  </div>

                  <SecLabel>Configuración tributaria</SecLabel>
                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                    <DToggle label="Prorrata de IVA" desc="Deducción parcial por actividad mixta" checked={!!clienteActivo.tiene_prorrata} onChange={v => setClienteActivo(p => ({ ...p, tiene_prorrata: v }))}>
                      {clienteActivo.tiene_prorrata && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="number" min="0" max="100" value={clienteActivo.prorrata_porcentaje || 0} onChange={e => { const v = e.target.value; setClienteActivo(p => ({ ...p, prorrata_porcentaje: v })) }} style={{ ...inp, width: 64 }} />
                          <span style={{ color: C.textMuted, fontSize: 12 }}>%</span>
                        </div>
                      )}
                    </DToggle>
                    <DToggle label="Operaciones intracomunitarias" desc="Compras / ventas dentro de la UE" checked={!!clienteActivo.operaciones_intracomunitarias} onChange={v => setClienteActivo(p => ({ ...p, operaciones_intracomunitarias: v }))} />
                    <DToggle label="Criterio de caja" desc="El IVA se devenga al cobro / pago efectivo" checked={!!clienteActivo.criterio_caja} onChange={v => setClienteActivo(p => ({ ...p, criterio_caja: v }))} />
                    <DToggle label="Inversión del sujeto pasivo" desc="Construcción, subcontratas, operaciones ISP" checked={!!clienteActivo.isp} onChange={v => setClienteActivo(p => ({ ...p, isp: v }))} last />
                  </div>
                </div>
              )}

              {/* ── REGLAS BASE ── */}
              {tabActiva === 'reglas' && (
                <div style={{ maxWidth: 900 }}>
                  <SecLabel>Reglas fiscales de este cliente</SecLabel>
                  <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 16, lineHeight: 1.6 }}>
                    n8n consulta estas reglas en PostgreSQL para cada factura entrante. Sin código hardcodeado — todo parametrizable por cliente.
                  </p>
                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                          {['Concepto / categoría', 'Tratamiento', '% Deducción', 'Base legal / criterio', ''].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10, color: C.textMuted, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {reglas.map(r => (
                          <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                            <td style={{ padding: '10px 14px', fontWeight: 500 }}>{r.concepto}</td>
                            <td style={{ padding: '10px 14px' }}>
                              <Pill bg={TAG[r.accion]?.bg} color={TAG[r.accion]?.color}>{TAG[r.accion]?.label || r.accion}</Pill>
                            </td>
                            <td style={{ padding: '10px 14px', color: r.accion === 'bloquear' ? C.textMuted : C.text }}>
                              {r.accion === 'bloquear' ? '—' : `${r.porcentaje}%`}
                            </td>
                            <td style={{ padding: '10px 14px', color: C.textMuted, fontSize: 11 }}>{r.base_legal}</td>
                            <td style={{ padding: '10px 14px' }}>
                              <span onClick={() => eliminarRegla(r.id)} style={{ fontSize: 11, color: C.textMuted, cursor: 'pointer', padding: '3px 8px', borderRadius: 6, border: `1px solid ${C.border}` }}>eliminar</span>
                            </td>
                          </tr>
                        ))}
                        {reglas.length === 0 && (
                          <tr><td colSpan={5} style={{ padding: '24px 14px', textAlign: 'center', color: C.textMuted }}>Sin reglas configuradas. Añade la primera abajo.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                    <SecLabel>Nueva regla</SecLabel>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <DField label="Concepto" style={{ flex: 2, minWidth: 160 }}>
                        <input placeholder="ej: Combustible / gasolina" value={nuevaRegla.concepto} onChange={e => { const v = e.target.value; setNuevaRegla(p => ({ ...p, concepto: v })) }} style={inp} />
                      </DField>
                      <DField label="Tratamiento" style={{ flex: 1, minWidth: 130 }}>
                        <select value={nuevaRegla.accion} onChange={e => { const v = e.target.value; setNuevaRegla(p => ({ ...p, accion: v })) }} style={inp}>
                          <option value="deducir">Deducible</option>
                          <option value="bloquear">Bloqueado</option>
                          <option value="prorrata">Prorrata</option>
                          <option value="isp">ISP</option>
                          <option value="intracomunitaria">Intracomunitaria</option>
                        </select>
                      </DField>
                      <DField label="%" style={{ width: 72 }}>
                        <input type="number" min="0" max="100" value={nuevaRegla.porcentaje} onChange={e => { const v = e.target.value; setNuevaRegla(p => ({ ...p, porcentaje: v })) }} style={inp} />
                      </DField>
                      <DField label="Base legal" style={{ flex: 2, minWidth: 160 }}>
                        <input placeholder="ej: Art. 95 LIVA — uso mixto vehículos" value={nuevaRegla.base_legal} onChange={e => { const v = e.target.value; setNuevaRegla(p => ({ ...p, base_legal: v })) }} style={inp} />
                      </DField>
                      <button onClick={añadirRegla} style={btnAcc}>+ Añadir</button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── EXCEPCIONES ── */}
              {tabActiva === 'excepciones' && (
                <div style={{ maxWidth: 820 }}>
                  {excPendientes.length > 0 && (
                    <div style={{ background: C.amberDim, border: `1px solid ${C.amber}33`, borderRadius: 10, padding: '10px 16px', marginBottom: 20, fontSize: 12, color: C.amber, display: 'flex', gap: 8 }}>
                      <span>⚠</span>
                      <span>{excPendientes.length} excepción{excPendientes.length > 1 ? 'es' : ''} pendiente{excPendientes.length > 1 ? 's' : ''} de revisión</span>
                    </div>
                  )}

                  <SecLabel>¿Qué es una excepción?</SecLabel>
                  <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 20, lineHeight: 1.6 }}>
                    Facturas que n8n detecta fuera del perfil habitual del cliente. Se procesan con el modelo fiscal correcto y quedan aquí para tu revisión mensual.
                  </p>

                  {excPendientes.length > 0 && (
                    <><div style={{ fontSize: 11, fontWeight: 600, color: C.amber, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Pendientes</div>
                    {excPendientes.map(e => <ExcCard key={e.id} exc={e} onMarcar={marcarRevisada} />)}</>
                  )}
                  {excProcesadas.length > 0 && (
                    <><div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10, marginTop: 20 }}>Revisadas</div>
                    {excProcesadas.map(e => <ExcCard key={e.id} exc={e} />)}</>
                  )}
                  {excepciones.length === 0 && <div style={{ padding: '32px 0', textAlign: 'center', color: C.textMuted, fontSize: 12 }}>Sin excepciones detectadas</div>}

                  <div style={{ height: 1, background: C.border, margin: '24px 0' }} />
                  <SecLabel>Configurar excepción anticipada</SecLabel>
                  <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 16, lineHeight: 1.6 }}>
                    Si sabes que va a llegar una factura atípica, configúrala antes. n8n la reconocerá y aplicará el modelo correcto.
                  </p>
                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                      <DField label="Tipo">
                        <select value={nuevaExcepcion.tipo} onChange={e => { const v = e.target.value; setNuevaExcepcion(p => ({ ...p, tipo: v })) }} style={inp}>
                          <option>Importación puntual</option>
                          <option>Intracomunitaria esporádica</option>
                          <option>Inversión sujeto pasivo</option>
                          <option>Gasto fuera de actividad</option>
                          <option>Operación exenta puntual</option>
                        </select>
                      </DField>
                      <DField label="Proveedor / emisor">
                        <input placeholder="Nombre o CIF del proveedor" value={nuevaExcepcion.proveedor} onChange={e => { const v = e.target.value; setNuevaExcepcion(p => ({ ...p, proveedor: v })) }} style={inp} />
                      </DField>
                      <DField label="Modelo fiscal a aplicar">
                        <select value={nuevaExcepcion.modelo_fiscal} onChange={e => { const v = e.target.value; setNuevaExcepcion(p => ({ ...p, modelo_fiscal: v })) }} style={inp}>
                          <option>ISP / Importación</option>
                          <option>Adquisición intracomunitaria</option>
                          <option>ISP nacional</option>
                          <option>No deducible</option>
                          <option>Exenta art.20 LIVA</option>
                        </select>
                      </DField>
                      <DField label="Descripción / criterio">
                        <input placeholder="Cómo debe tratarse esta factura" value={nuevaExcepcion.descripcion} onChange={e => { const v = e.target.value; setNuevaExcepcion(p => ({ ...p, descripcion: v })) }} style={inp} />
                      </DField>
                    </div>
                    <button onClick={guardarExcepcion} style={btnAcc}>Guardar excepción</button>
                  </div>
                </div>
              )}

              {/* ── FACTURAS ── */}
              {tabActiva === 'facturas' && (
                <div style={{ maxWidth: 960 }}>
                  <SecLabel>Facturas procesadas por n8n</SecLabel>
                  <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 16, lineHeight: 1.6 }}>
                    Facturas que n8n ha procesado para este cliente. Las pendientes requieren tu revisión.
                  </p>
                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                          {['Nº Factura', 'Emisor', 'Fecha', 'Base imp.', 'IVA deducible', 'Estado', 'Confianza'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10, color: C.textMuted, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {facturas.map((f, i) => (
                          <tr key={f.id || i} style={{ borderBottom: `1px solid ${C.border}` }}>
                            <td style={{ padding: '10px 14px', fontWeight: 500, color: C.accent }}>{f.numero_factura || f['Nº Factura'] || '—'}</td>
                            <td style={{ padding: '10px 14px' }}>{f.emisor_nombre || f['Emisor'] || '—'}</td>
                            <td style={{ padding: '10px 14px', color: C.textMuted, fontSize: 11 }}>{f.fecha_factura || f['Fecha'] || '—'}</td>
                            <td style={{ padding: '10px 14px' }}>{f.base_imponible || f['Base Imponible'] ? `${parseFloat(f.base_imponible || f['Base Imponible'] || 0).toFixed(2)} €` : '—'}</td>
                            <td style={{ padding: '10px 14px', color: C.green }}>{f.iva_deducible || f['IVA Deducible'] ? `${parseFloat(f.iva_deducible || f['IVA Deducible'] || 0).toFixed(2)} €` : '—'}</td>
                            <td style={{ padding: '10px 14px' }}>
                              <Pill bg={f.estado === 'pendiente' ? C.amberDim : f.estado === 'aprobada' ? C.greenDim : C.accentDim} color={f.estado === 'pendiente' ? C.amber : f.estado === 'aprobada' ? C.green : C.accent}>
                                {f.estado || 'procesada'}
                              </Pill>
                            </td>
                            <td style={{ padding: '10px 14px' }}>
                              <Pill bg={f.confianza === 'alta' ? C.greenDim : f.confianza === 'baja' ? C.redDim : C.amberDim} color={f.confianza === 'alta' ? C.green : f.confianza === 'baja' ? C.red : C.amber}>
                                {f.confianza || '—'}
                              </Pill>
                            </td>
                          </tr>
                        ))}
                        {facturas.length === 0 && (
                          <tr><td colSpan={7} style={{ padding: '24px 14px', textAlign: 'center', color: C.textMuted }}>Sin facturas procesadas aún</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── INFORME ── */}
              {tabActiva === 'informe' && (
                <div style={{ maxWidth: 820 }}>
                  <SecLabel>Informe mensual de excepciones</SecLabel>
                  <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 20, lineHeight: 1.6 }}>
                    n8n genera y envía este informe en PDF el último día de cada mes. También puedes solicitarlo ahora manualmente.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 24 }}>
                    <StatCard num={excepciones.length} label="Total excepciones" />
                    <StatCard num={excPendientes.length} label="Pendientes" color={C.amber} />
                    <StatCard num={facturas.length} label="Facturas procesadas" color={C.blue} />
                  </div>

                  {excepciones.length > 0 && (
                    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                            {['Proveedor', 'Tipo', 'Modelo aplicado', 'Fecha', 'Estado'].map(h => (
                              <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {excepciones.map(e => (
                            <tr key={e.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                              <td style={{ padding: '10px 14px', fontWeight: 500 }}>{e.proveedor}</td>
                              <td style={{ padding: '10px 14px', color: C.textMuted, fontSize: 11 }}>{e.tipo}</td>
                              <td style={{ padding: '10px 14px' }}><Pill bg={C.blueDim} color={C.blue}>{e.modelo_fiscal}</Pill></td>
                              <td style={{ padding: '10px 14px', color: C.textMuted, fontSize: 11 }}>{e.creado_en?.split('T')[0]}</td>
                              <td style={{ padding: '10px 14px' }}>
                                <Pill bg={e.estado === 'pendiente' ? C.amberDim : C.greenDim} color={e.estado === 'pendiente' ? C.amber : C.green}>{e.estado}</Pill>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Solicitar informe PDF ahora</div>
                    <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 14, lineHeight: 1.6 }}>
                      n8n recibirá la solicitud, generará el PDF con todas las excepciones y te lo enviará por email.
                    </div>
                    <div style={{ fontSize: 11, color: C.textMuted, fontFamily: 'monospace', background: C.bg, padding: '8px 12px', borderRadius: 8, marginBottom: 14, border: `1px solid ${C.border}` }}>
                      NEXT_PUBLIC_N8N_BASE_URL=https://tu-n8n.com
                    </div>
                    <button onClick={solicitarInforme} style={btnAcc}>Solicitar informe →</button>
                  </div>
                </div>
              )}

            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── COMPONENTES ───────────────────────────────────────────────────────────────

function SecLabel({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>{children}</div>
}

function DField({ label, children, style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, ...style }}>
      <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  )
}

function DToggle({ label, desc, checked, onChange, children, last }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderBottom: last ? 'none' : '1px solid #1e1e2e' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#f1f1f5' }}>{label}</div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{desc}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {children}
        <div onClick={() => onChange(!checked)} style={{ width: 38, height: 22, borderRadius: 11, cursor: 'pointer', position: 'relative', background: checked ? '#6366f1' : '#374151', transition: 'background 0.2s', flexShrink: 0 }}>
          <div style={{ position: 'absolute', width: 18, height: 18, borderRadius: 9, background: '#fff', top: 2, left: checked ? 18 : 2, transition: 'left 0.2s' }} />
        </div>
      </div>
    </div>
  )
}

function Pill({ bg, color, children }) {
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: bg, color }}>{children}</span>
}

function ExcCard({ exc, onMarcar }) {
  return (
    <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 10, padding: '12px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{exc.proveedor}</span>
          <span style={{ color: '#6b7280', fontSize: 12 }}> · {exc.tipo}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, marginLeft: 12 }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>{exc.creado_en?.split('T')[0]}</span>
          <Pill bg={exc.estado === 'pendiente' ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)'} color={exc.estado === 'pendiente' ? '#f59e0b' : '#10b981'}>{exc.estado}</Pill>
        </div>
      </div>
      {exc.descripcion && <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5, marginBottom: 8 }}>{exc.descripcion}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Pill bg="rgba(59,130,246,0.12)" color="#3b82f6">{exc.modelo_fiscal}</Pill>
        {exc.estado === 'pendiente' && onMarcar && (
          <button onClick={() => onMarcar(exc.id)} style={{ fontSize: 11, padding: '4px 12px', border: '1px solid #2a2a3e', borderRadius: 6, cursor: 'pointer', background: 'transparent', color: '#9ca3af' }}>
            Marcar revisada
          </button>
        )}
      </div>
    </div>
  )
}

function StatCard({ num, label, color }) {
  return (
    <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || '#f1f1f5', letterSpacing: '-1px' }}>{num}</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>{label}</div>
    </div>
  )
}

const inp = { padding: '7px 10px', fontSize: 12, background: '#0a0a0f', border: '1px solid #1e1e2e', borderRadius: 8, color: '#f1f1f5', width: '100%', outline: 'none', boxSizing: 'border-box' }
const btnAcc = { padding: '8px 18px', fontSize: 12, fontWeight: 600, background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }