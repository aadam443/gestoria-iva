'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export default function Dashboard() {
  const [clientes, setClientes] = useState([])
  const [clienteActivo, setClienteActivo] = useState(null)
  const [tabActiva, setTabActiva] = useState('ficha')
  const [reglas, setReglas] = useState([])
  const [excepciones, setExcepciones] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState(null)
  const [nuevaRegla, setNuevaRegla] = useState({ concepto: '', accion: 'deducir', porcentaje: 100, base_legal: '' })
  const [nuevaExcepcion, setNuevaExcepcion] = useState({ tipo: 'Importación puntual', proveedor: '', modelo_fiscal: 'ISP / Importación', descripcion: '' })

  const mostrarMensaje = useCallback((texto, tipo) => {
    setMensaje({ texto, tipo })
    setTimeout(() => setMensaje(null), 3000)
  }, [])

  const cargarClientes = useCallback(async () => {
    const { data, error } = await supabase
      .from('clientes')
      .select('id, nombre, cif, regimen_iva, actividad, cnae, tiene_prorrata, prorrata_porcentaje, operaciones_intracomunitarias')
      .order('nombre')
    if (error) { mostrarMensaje('Error cargando clientes: ' + error.message, 'error'); return }
    setClientes(data || [])
  }, [mostrarMensaje])

  const cargarReglas = useCallback(async (clienteId) => {
    const { data, error } = await supabase
      .from('reglas_fiscales')
      .select('*')
      .eq('cliente_id', clienteId)
      .eq('activa', true)
      .order('concepto')
    if (error) { mostrarMensaje('Error cargando reglas: ' + error.message, 'error'); return }
    setReglas(data || [])
  }, [mostrarMensaje])

  const cargarExcepciones = useCallback(async (clienteId) => {
    const { data, error } = await supabase
      .from('excepciones_fiscales')
      .select('*')
      .eq('cliente_id', clienteId)
      .order('creado_en', { ascending: false })
    if (error) { mostrarMensaje('Error cargando excepciones: ' + error.message, 'error'); return }
    setExcepciones(data || [])
  }, [mostrarMensaje])

  useEffect(() => {
    cargarClientes()
  }, [cargarClientes])

  async function seleccionarCliente(cliente) {
    setClienteActivo(cliente)
    setTabActiva('ficha')
    await cargarReglas(cliente.id)
    await cargarExcepciones(cliente.id)
  }

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
    if (error) { mostrarMensaje('Error guardando: ' + error.message, 'error'); return }
    mostrarMensaje('Ficha guardada correctamente', 'ok')
    await notificarN8n('cliente_actualizado', { cliente_id: clienteActivo.id })
  }

  async function añadirRegla() {
    if (!nuevaRegla.concepto) { mostrarMensaje('Escribe un concepto', 'error'); return }
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
    if (error) { mostrarMensaje('Error añadiendo regla: ' + error.message, 'error'); return }
    setReglas(prev => [...prev, data[0]])
    setNuevaRegla({ concepto: '', accion: 'deducir', porcentaje: 100, base_legal: '' })
    mostrarMensaje('Regla añadida. n8n la aplicará desde ahora.', 'ok')
  }

  async function eliminarRegla(reglaId) {
    const { error } = await supabase
      .from('reglas_fiscales')
      .update({ activa: false })
      .eq('id', reglaId)
    if (error) { mostrarMensaje('Error eliminando regla', 'error'); return }
    setReglas(prev => prev.filter(r => r.id !== reglaId))
    mostrarMensaje('Regla desactivada', 'ok')
  }

  async function guardarExcepcion() {
    if (!nuevaExcepcion.proveedor) { mostrarMensaje('Escribe el proveedor', 'error'); return }
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
    if (error) { mostrarMensaje('Error guardando excepción: ' + error.message, 'error'); return }
    setExcepciones(prev => [data[0], ...prev])
    setNuevaExcepcion({ tipo: 'Importación puntual', proveedor: '', modelo_fiscal: 'ISP / Importación', descripcion: '' })
    mostrarMensaje('Excepción guardada. n8n la tendrá en cuenta.', 'ok')
  }

  async function marcarRevisada(excepcionId) {
    const { error } = await supabase
      .from('excepciones_fiscales')
      .update({ estado: 'procesada' })
      .eq('id', excepcionId)
    if (error) { mostrarMensaje('Error actualizando excepción', 'error'); return }
    setExcepciones(prev => prev.map(e => e.id === excepcionId ? { ...e, estado: 'procesada' } : e))
  }

  async function notificarN8n(evento, datos) {
    const url = process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL
    if (!url) return
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evento, ...datos, timestamp: new Date().toISOString() })
      })
    } catch (e) {
      console.warn('n8n no disponible:', e.message)
    }
  }

  const clientesFiltrados = clientes.filter(c =>
    c.nombre?.toLowerCase().includes(busqueda.toLowerCase()) ||
    c.cif?.includes(busqueda)
  )

  const excPendientes = excepciones.filter(e => e.estado === 'pendiente')
  const excProcesadas = excepciones.filter(e => e.estado === 'procesada')
  const tagClase = { deducir: 'tag-ded', bloquear: 'tag-block', prorrata: 'tag-rev', isp: 'tag-isp', intracomunitaria: 'tag-intra' }
  const tagLabel = { deducir: 'deducible', bloquear: 'bloqueado', prorrata: 'prorrata', isp: 'ISP', intracomunitaria: 'intracomunitaria' }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif', fontSize: 13, background: '#f4f4f5' }}>

      {/* SIDEBAR */}
      <div style={{ width: 220, background: '#fff', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Gestoría</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Panel de expedientes</div>
        </div>
        <div style={{ padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }}>
          <input
            placeholder="Buscar cliente..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            style={{ width: '100%', padding: '5px 8px', fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#f9fafb' }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {clientesFiltrados.map(c => {
            const activo = clienteActivo?.id === c.id
            return (
              <div key={c.id} onClick={() => seleccionarCliente(c)} style={{ padding: '8px 14px', cursor: 'pointer', borderLeft: activo ? '2px solid #2563eb' : '2px solid transparent', background: activo ? '#eff6ff' : 'transparent' }}>
                <div style={{ fontWeight: 500, fontSize: 12, color: activo ? '#1d4ed8' : '#111' }}>{c.nombre}</div>
                <div style={{ fontSize: 11, color: activo ? '#3b82f6' : '#9ca3af', marginTop: 1 }}>{c.cif} · {c.regimen_iva}</div>
              </div>
            )
          })}
          {clientesFiltrados.length === 0 && clientes.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>Cargando clientes...</div>
          )}
          {clientesFiltrados.length === 0 && clientes.length > 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>Sin resultados</div>
          )}
        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        <div style={{ padding: '12px 20px', background: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{clienteActivo?.nombre || 'Selecciona un cliente'}</div>
            {clienteActivo && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{clienteActivo.cif} · {clienteActivo.actividad || ''}</div>}
          </div>
          {clienteActivo && (
            <button onClick={guardarFicha} disabled={guardando} style={btnPrimaryStyle}>
              {guardando ? 'Guardando...' : 'Guardar cambios'}
            </button>
          )}
        </div>

        {mensaje && (
          <div style={{ padding: '8px 20px', fontSize: 12, fontWeight: 500, background: mensaje.tipo === 'ok' ? '#f0fdf4' : '#fef2f2', color: mensaje.tipo === 'ok' ? '#166534' : '#991b1b', borderBottom: `1px solid ${mensaje.tipo === 'ok' ? '#bbf7d0' : '#fecaca'}` }}>
            {mensaje.texto}
          </div>
        )}

        {!clienteActivo ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 13 }}>
            Selecciona un cliente para ver su expediente fiscal
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 20px' }}>
              {[
                { id: 'ficha', label: 'Ficha fiscal' },
                { id: 'reglas', label: 'Reglas base' },
                { id: 'excepciones', label: `Excepciones${excPendientes.length > 0 ? ` (${excPendientes.length})` : ''}` },
                { id: 'informe', label: 'Informe mensual' },
              ].map(t => (
                <div key={t.id} onClick={() => setTabActiva(t.id)} style={{ padding: '8px 14px', fontSize: 12, cursor: 'pointer', borderBottom: tabActiva === t.id ? '2px solid #2563eb' : '2px solid transparent', color: tabActiva === t.id ? '#2563eb' : '#6b7280', fontWeight: tabActiva === t.id ? 600 : 400, marginBottom: -1 }}>
                  {t.label}
                </div>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

              {/* FICHA FISCAL */}
              {tabActiva === 'ficha' && (
                <div>
                  <SectionTitle>Identidad fiscal</SectionTitle>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <Field label="Razón social"><input defaultValue={clienteActivo.nombre} style={inputStyle} /></Field>
                    <Field label="CIF / NIF"><input defaultValue={clienteActivo.cif} style={inputStyle} /></Field>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                    <Field label="Actividad"><input defaultValue={clienteActivo.actividad || ''} style={inputStyle} /></Field>
                    <Field label="CNAE"><input defaultValue={clienteActivo.cnae || ''} style={inputStyle} /></Field>
                    <Field label="Régimen IVA">
                      <select
                        value={clienteActivo.regimen_iva || 'general'}
                        onChange={e => { const v = e.target.value; setClienteActivo(prev => ({ ...prev, regimen_iva: v })) }}
                        style={inputStyle}
                      >
                        <option value="general">General</option>
                        <option value="exento">Exento</option>
                        <option value="simplificado">Simplificado</option>
                        <option value="recargo">Recargo de equivalencia</option>
                        <option value="rebu">REBU</option>
                      </select>
                    </Field>
                  </div>
                  <SectionTitle style={{ marginTop: 16 }}>Configuración tributaria</SectionTitle>
                  <ToggleRow label="Prorrata de IVA" desc="Deducción parcial por actividad mixta" checked={!!clienteActivo.tiene_prorrata} onChange={v => setClienteActivo(prev => ({ ...prev, tiene_prorrata: v }))}>
                    {clienteActivo.tiene_prorrata && (
                      <input type="number" min="0" max="100"
                        value={clienteActivo.prorrata_porcentaje || 0}
                        onChange={e => { const v = e.target.value; setClienteActivo(prev => ({ ...prev, prorrata_porcentaje: v })) }}
                        style={{ ...inputStyle, width: 70 }}
                      />
                    )}
                  </ToggleRow>
                  <ToggleRow label="Operaciones intracomunitarias" desc="Compras / ventas dentro de la UE" checked={!!clienteActivo.operaciones_intracomunitarias} onChange={v => setClienteActivo(prev => ({ ...prev, operaciones_intracomunitarias: v }))} />
                  <ToggleRow label="Criterio de caja" desc="El IVA se devenga al cobro / pago" checked={!!clienteActivo.criterio_caja} onChange={v => setClienteActivo(prev => ({ ...prev, criterio_caja: v }))} />
                  <ToggleRow label="Inversión del sujeto pasivo" desc="Construcción, subcontratas, ISP" checked={!!clienteActivo.isp} onChange={v => setClienteActivo(prev => ({ ...prev, isp: v }))} />
                </div>
              )}

              {/* REGLAS BASE */}
              {tabActiva === 'reglas' && (
                <div>
                  <SectionTitle>Reglas fiscales base de este cliente</SectionTitle>
                  <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 12 }}>
                    n8n consulta estas reglas automáticamente para cada factura entrante. Las excepciones puntuales se gestionan en la pestaña siguiente.
                  </p>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>{['Concepto', 'Tratamiento', '% Deducción', 'Base legal', ''].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #e5e7eb', fontSize: 11, color: '#9ca3af', fontWeight: 500 }}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {reglas.map(r => (
                        <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '7px 8px' }}>{r.concepto}</td>
                          <td style={{ padding: '7px 8px' }}><Tag tipo={tagClase[r.accion]}>{tagLabel[r.accion] || r.accion}</Tag></td>
                          <td style={{ padding: '7px 8px' }}>{r.accion === 'bloquear' ? '—' : `${r.porcentaje}%`}</td>
                          <td style={{ padding: '7px 8px', color: '#9ca3af', fontSize: 11 }}>{r.base_legal}</td>
                          <td style={{ padding: '7px 8px' }}>
                            <span onClick={() => eliminarRegla(r.id)} style={{ fontSize: 11, color: '#9ca3af', cursor: 'pointer' }}>eliminar</span>
                          </td>
                        </tr>
                      ))}
                      {reglas.length === 0 && (
                        <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>Sin reglas configuradas. Añade la primera abajo.</td></tr>
                      )}
                    </tbody>
                  </table>
                  <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <Field label="Concepto" style={{ flex: 2, minWidth: 140 }}>
                      <input placeholder="ej: Combustible / gasolina" value={nuevaRegla.concepto}
                        onChange={e => { const v = e.target.value; setNuevaRegla(prev => ({ ...prev, concepto: v })) }}
                        style={inputStyle} />
                    </Field>
                    <Field label="Tratamiento" style={{ flex: 1, minWidth: 120 }}>
                      <select value={nuevaRegla.accion} onChange={e => { const v = e.target.value; setNuevaRegla(prev => ({ ...prev, accion: v })) }} style={inputStyle}>
                        <option value="deducir">Deducible</option>
                        <option value="bloquear">Bloqueado</option>
                        <option value="prorrata">Prorrata</option>
                        <option value="isp">ISP</option>
                        <option value="intracomunitaria">Intracomunitaria</option>
                      </select>
                    </Field>
                    <Field label="%" style={{ width: 70 }}>
                      <input type="number" min="0" max="100" value={nuevaRegla.porcentaje}
                        onChange={e => { const v = e.target.value; setNuevaRegla(prev => ({ ...prev, porcentaje: v })) }}
                        style={inputStyle} />
                    </Field>
                    <Field label="Base legal" style={{ flex: 2, minWidth: 140 }}>
                      <input placeholder="ej: Art. 95 LIVA" value={nuevaRegla.base_legal}
                        onChange={e => { const v = e.target.value; setNuevaRegla(prev => ({ ...prev, base_legal: v })) }}
                        style={inputStyle} />
                    </Field>
                    <button onClick={añadirRegla} style={btnPrimaryStyle}>+ Añadir regla</button>
                  </div>
                </div>
              )}

              {/* EXCEPCIONES */}
              {tabActiva === 'excepciones' && (
                <div>
                  {excPendientes.length > 0 && (
                    <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 12, color: '#92400e' }}>
                      ⚠ {excPendientes.length} excepción{excPendientes.length > 1 ? 'es' : ''} pendiente{excPendientes.length > 1 ? 's' : ''} de revisión
                    </div>
                  )}
                  <SectionTitle>¿Qué es una excepción?</SectionTitle>
                  <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 14 }}>
                    Facturas que n8n detecta como fuera del perfil habitual del cliente. Se procesan con el modelo fiscal correcto pero quedan aquí para tu revisión mensual.
                  </p>
                  {excPendientes.length > 0 && (
                    <><SectionTitle>Pendientes de revisión</SectionTitle>
                    {excPendientes.map(e => <ExcCard key={e.id} exc={e} onMarcar={marcarRevisada} />)}</>
                  )}
                  {excProcesadas.length > 0 && (
                    <><SectionTitle style={{ marginTop: 14 }}>Ya revisadas</SectionTitle>
                    {excProcesadas.map(e => <ExcCard key={e.id} exc={e} />)}</>
                  )}
                  {excepciones.length === 0 && (
                    <div style={{ padding: 30, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>Sin excepciones detectadas este período</div>
                  )}
                  <SectionTitle style={{ marginTop: 20 }}>Configurar excepción anticipada</SectionTitle>
                  <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 10 }}>
                    Si sabes que va a llegar una factura atípica, configúrala antes de que llegue. n8n la reconocerá y aplicará el tratamiento correcto.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <Field label="Tipo de excepción">
                      <select value={nuevaExcepcion.tipo} onChange={e => { const v = e.target.value; setNuevaExcepcion(prev => ({ ...prev, tipo: v })) }} style={inputStyle}>
                        <option>Importación puntual</option>
                        <option>Intracomunitaria esporádica</option>
                        <option>Inversión sujeto pasivo</option>
                        <option>Gasto fuera de actividad</option>
                        <option>Operación exenta puntual</option>
                      </select>
                    </Field>
                    <Field label="Proveedor / emisor">
                      <input placeholder="Nombre o CIF del proveedor" value={nuevaExcepcion.proveedor}
                        onChange={e => { const v = e.target.value; setNuevaExcepcion(prev => ({ ...prev, proveedor: v })) }}
                        style={inputStyle} />
                    </Field>
                    <Field label="Modelo fiscal a aplicar">
                      <select value={nuevaExcepcion.modelo_fiscal} onChange={e => { const v = e.target.value; setNuevaExcepcion(prev => ({ ...prev, modelo_fiscal: v })) }} style={inputStyle}>
                        <option>ISP / Importación</option>
                        <option>Adquisición intracomunitaria</option>
                        <option>ISP nacional</option>
                        <option>No deducible</option>
                        <option>Exenta art.20 LIVA</option>
                      </select>
                    </Field>
                    <Field label="Descripción / criterio">
                      <input placeholder="Cómo debe tratarse esta factura" value={nuevaExcepcion.descripcion}
                        onChange={e => { const v = e.target.value; setNuevaExcepcion(prev => ({ ...prev, descripcion: v })) }}
                        style={inputStyle} />
                    </Field>
                  </div>
                  <button onClick={guardarExcepcion} style={btnPrimaryStyle}>Guardar excepción</button>
                </div>
              )}

              {/* INFORME MENSUAL */}
              {tabActiva === 'informe' && (
                <div>
                  <SectionTitle>Informe mensual de excepciones</SectionTitle>
                  <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 14 }}>
                    Resumen de operaciones atípicas del mes actual. El informe global se genera automáticamente el último día del mes y se envía por email al gestor.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
                    <StatCard num={excepciones.length} label="Total excepciones" />
                    <StatCard num={excPendientes.length} label="Pendientes revisión" color="#dc2626" />
                    <StatCard num={excProcesadas.length} label="Revisadas" color="#16a34a" />
                  </div>
                  {excepciones.length === 0 ? (
                    <div style={{ padding: 30, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>Sin excepciones este período. Todo procesado con reglas estándar.</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr>{['Proveedor', 'Tipo', 'Modelo aplicado', 'Fecha', 'Estado'].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #e5e7eb', fontSize: 11, color: '#9ca3af', fontWeight: 500 }}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {excepciones.map(e => (
                          <tr key={e.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '7px 8px', fontWeight: 500 }}>{e.proveedor}</td>
                            <td style={{ padding: '7px 8px', fontSize: 11, color: '#6b7280' }}>{e.tipo}</td>
                            <td style={{ padding: '7px 8px' }}><Tag tipo="tag-intra">{e.modelo_fiscal}</Tag></td>
                            <td style={{ padding: '7px 8px', color: '#9ca3af', fontSize: 11 }}>{e.creado_en?.split('T')[0]}</td>
                            <td style={{ padding: '7px 8px' }}><Tag tipo={e.estado === 'pendiente' ? 'tag-block' : 'tag-ded'}>{e.estado}</Tag></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div style={{ marginTop: 20, padding: 14, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Envío automático del PDF mensual</div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 10 }}>n8n genera y envía el informe PDF al gestor el último día de cada mes.</div>
                    <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace', background: '#f3f4f6', padding: '6px 10px', borderRadius: 6 }}>
                      NEXT_PUBLIC_N8N_WEBHOOK_URL=https://tu-n8n.com/webhook/informe-mensual
                    </div>
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

function SectionTitle({ children, style }) {
  return <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10, ...style }}>{children}</div>
}

function Field({ label, children, style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, ...style }}>
      <label style={{ fontSize: 11, color: '#6b7280' }}>{label}</label>
      {children}
    </div>
  )
}

function ToggleRow({ label, desc, checked, onChange, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{desc}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {children}
        <div onClick={() => onChange(!checked)} style={{ width: 36, height: 20, borderRadius: 10, cursor: 'pointer', position: 'relative', background: checked ? '#2563eb' : '#d1d5db' }}>
          <div style={{ position: 'absolute', width: 16, height: 16, borderRadius: 8, background: '#fff', top: 2, left: checked ? 18 : 2, transition: '0.15s' }} />
        </div>
      </div>
    </div>
  )
}

function Tag({ tipo, children }) {
  const styles = {
    'tag-ded': { background: '#f0fdf4', color: '#166534' },
    'tag-block': { background: '#fef2f2', color: '#991b1b' },
    'tag-rev': { background: '#fffbeb', color: '#92400e' },
    'tag-intra': { background: '#eff6ff', color: '#1e40af' },
    'tag-isp': { background: '#f5f3ff', color: '#5b21b6' },
  }
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, ...styles[tipo] }}>{children}</span>
}

function ExcCard({ exc, onMarcar }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', marginBottom: 8, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontWeight: 600, fontSize: 12 }}>{exc.proveedor} · <span style={{ fontWeight: 400, color: '#6b7280' }}>{exc.tipo}</span></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>{exc.creado_en?.split('T')[0]}</span>
          <Tag tipo={exc.estado === 'pendiente' ? 'tag-block' : 'tag-ded'}>{exc.estado}</Tag>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>{exc.descripcion}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
        <Tag tipo="tag-intra">Modelo: {exc.modelo_fiscal}</Tag>
        {exc.estado === 'pendiente' && onMarcar && (
          <button onClick={() => onMarcar(exc.id)} style={{ fontSize: 11, padding: '3px 10px', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', background: '#fff' }}>
            Marcar revisada
          </button>
        )}
      </div>
    </div>
  )
}

function StatCard({ num, label, color }) {
  return (
    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px' }}>
      <div style={{ fontSize: 22, fontWeight: 600, color: color || '#111' }}>{num}</div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{label}</div>
    </div>
  )
}

const inputStyle = {
  padding: '5px 8px', fontSize: 12, border: '1px solid #e5e7eb',
  borderRadius: 6, background: '#f9fafb', color: '#111', width: '100%'
}

const btnPrimaryStyle = {
  padding: '6px 14px', fontSize: 12, background: '#2563eb', color: '#fff',
  border: 'none', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap'
}

