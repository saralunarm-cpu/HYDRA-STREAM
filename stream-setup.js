// stream-setup.js — streaming entre navegadores para Hydra (reemplaza pb.setName / initStream)
// Uso:  compartir("ana")            -> transmite tu salida de Hydra con ese nombre
//       recibir(s0, "ana")          -> recibe la salida de "ana" en la fuente s0
//       quienes()                   -> lista en la consola los nombres disponibles
(() => {
  if (window.__cc) window.__cc.cerrar()
  const sg = pb.signaller
  const cc = { nombre: null, salida: null, dir: {}, entrantes: {}, salientes: {}, timers: [] }
  window.__cc = cc

  const ice = () => ({
    iceServers: (pb.iceServers || [{ urls: "stun:stun.l.google.com:19302" }]).map(s => {
      const o = { urls: s.urls || s.url }
      if (s.username) o.username = s.username
      if (s.credential) o.credential = s.credential
      return o
    })
  })

  // espera a que el navegador termine de reunir sus rutas de conexión (máx. 4 s)
  const listo = (pc) => new Promise(res => {
    if (pc.iceGatheringState === "complete") return res()
    const t = setTimeout(res, 4000)
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") { clearTimeout(t); res() }
    })
  })

  const anunciar = () => {
    if (cc.nombre && sg.id) sg.emit("broadcast", { type: "cc-aqui", nombre: cc.nombre, sid: sg.id })
  }

  const alDifundir = (d) => {
    if (!d || !d.type) return
    if (d.type === "cc-aqui") cc.dir[d.nombre] = d.sid
    if (d.type === "cc-busco" && d.nombre === cc.nombre) anunciar()
  }

  const alMensaje = async (m) => {
    if (!m || m.type !== "cc" || !m.message) return
    const de = m.id
    const { que, desc, nombre } = m.message
    try {
      if (que === "oferta" && cc.salida && nombre === cc.nombre) {
        if (cc.salientes[de]) cc.salientes[de].close()
        const pc = new RTCPeerConnection(ice())
        cc.salientes[de] = pc
        cc.salida.getTracks().forEach(t => pc.addTrack(t, cc.salida))
        await pc.setRemoteDescription(desc)
        await pc.setLocalDescription(await pc.createAnswer())
        await listo(pc)
        sg.emit("message", { id: de, type: "cc", message: { que: "respuesta", nombre, desc: pc.localDescription } })
      }
      if (que === "respuesta" && cc.entrantes[nombre]) {
        const pc = cc.entrantes[nombre].pc
        if (pc && pc.signalingState === "have-local-offer") await pc.setRemoteDescription(desc)
      }
    } catch (e) { console.log("stream-setup:", e.message) }
  }

  sg.on("broadcast", alDifundir)
  sg.on("message", alMensaje)
  sg.on("connect", anunciar)

  window.compartir = (nombre) => {
    cc.nombre = nombre
    cc.salida = pb.stream || document.querySelector("canvas").captureStream(25)
    anunciar()
    console.log("compartiendo como:", nombre)
  }

  window.recibir = (fuente, nombre) => {
    if (cc.entrantes[nombre]) { clearInterval(cc.entrantes[nombre].timer); if (cc.entrantes[nombre].pc) cc.entrantes[nombre].pc.close() }
    const en = { pc: null, timer: null, intentando: false, video: null, desde: 0 }
    cc.entrantes[nombre] = en

    const conectar = async () => {
      const sid = cc.dir[nombre]
      if (!sid) { sg.emit("broadcast", { type: "cc-busco", nombre }); return }
      if (en.intentando) return
      const estado = en.pc ? en.pc.connectionState : "nada"
      if (estado === "connected") return
      // una oferta en curso tiene 12 s para conectar antes de reintentar
      if ((estado === "new" || estado === "connecting") && Date.now() - en.desde < 12000) return
      if (estado !== "nada") delete cc.dir[nombre]
      if (!cc.dir[nombre]) { sg.emit("broadcast", { type: "cc-busco", nombre }); if (en.pc) { en.pc.close(); en.pc = null } return }
      en.intentando = true
      en.desde = Date.now()
      try {
        if (en.pc) en.pc.close()
        const pc = new RTCPeerConnection(ice())
        en.pc = pc
        pc.addTransceiver("video", { direction: "recvonly" })
        pc.ontrack = (ev) => {
          const v = document.createElement("video")
          v.muted = true
          v.autoplay = true
          v.playsInline = true
          v.srcObject = ev.streams[0] || new MediaStream([ev.track])
          v.play().catch(() => {})
          en.video = v
          fuente.init({ src: v, dynamic: true })
          console.log("recibiendo:", nombre)
        }
        await pc.setLocalDescription(await pc.createOffer())
        await listo(pc)
        sg.emit("message", { id: sid, type: "cc", message: { que: "oferta", nombre, desc: pc.localDescription } })
      } catch (e) { console.log("stream-setup:", e.message) }
      en.intentando = false
    }
    conectar()
    en.timer = setInterval(conectar, 2500)
  }

  window.quienes = () => { console.log(Object.keys(cc.dir)); return Object.keys(cc.dir) }

  cc.cerrar = () => {
    sg.off("broadcast", alDifundir)
    sg.off("message", alMensaje)
    sg.off("connect", anunciar)
    Object.values(cc.entrantes).forEach(e => { clearInterval(e.timer); if (e.pc) e.pc.close() })
    Object.values(cc.salientes).forEach(pc => pc.close())
  }
  console.log("stream-setup listo")
})()
