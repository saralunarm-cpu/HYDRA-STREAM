// taller.js — Hydra en red para el taller Cartografías de lo común
//
//   cargar(s0)                -> elige una imagen o un video de tu computador y lo pone en s0
//   compartir("ana", s0)      -> comparte tu imagen como "ana" y tu pantalla como "ana-pantalla"
//   compartir("ana")          -> comparte solo tu pantalla como "ana"
//   recibir(s1, "luis")       -> recibe a "luis" dentro de la fuente s1
//   ver("luis-pantalla")      -> abre una ventanita para mirar esa transmisión
//   quienes()                 -> muestra los nombres que están compartiendo
//
// Se puede ejecutar todo el código muchas veces: nada se desconecta ni se vuelve a pedir.
(() => {
  const VERSION = 3
  if (window.__cc && window.__cc.version === VERSION) return
  if (window.__cc && window.__cc.cerrar) window.__cc.cerrar()

  const sg = pb.signaller
  const cc = { version: VERSION, salidas: {}, dir: {}, entrantes: {}, salientes: {}, archivos: new Map(), vistas: {}, timers: [], n: 0 }
  window.__cc = cc
  const norm = (s) => String(s).trim().toLowerCase()

  // ---------- avisos en pantalla (no salen en la transmisión) ----------
  const caja = document.createElement("div")
  caja.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:99999;font:13px/1.5 monospace;color:#fff;background:rgba(0,0,0,.7);padding:6px 10px;border-radius:6px;max-width:46vw;pointer-events:none;display:none"
  document.body.appendChild(caja)
  const lineas = []
  const aviso = (t) => {
    if (lineas[lineas.length - 1] === t) return
    lineas.push(t)
    while (lineas.length > 4) lineas.shift()
    caja.textContent = ""
    lineas.forEach(l => { const d = document.createElement("div"); d.textContent = l; caja.appendChild(d) })
    caja.style.display = "block"
    console.log("taller:", t)
  }

  // ---------- conexión ----------
  const ice = () => ({
    iceServers: (pb.iceServers || [{ urls: "stun:stun.l.google.com:19302" }]).map(s => {
      const o = { urls: s.urls || s.url }
      if (s.username) o.username = s.username
      if (s.credential) o.credential = s.credential
      return o
    })
  })

  const listo = (pc) => new Promise(res => {
    if (pc.iceGatheringState === "complete") return res()
    const t = setTimeout(res, 4000)
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") { clearTimeout(t); res() }
    })
  })

  const anunciar = (nombre) => {
    if (!sg.id) return
    const nombres = nombre ? [nombre] : Object.keys(cc.salidas)
    nombres.forEach(n => { if (cc.salidas[n]) sg.emit("broadcast", { type: "cc-aqui", nombre: n, sid: sg.id }) })
  }

  const alDifundir = (d) => {
    if (!d || !d.type) return
    if (d.type === "cc-aqui") cc.dir[d.nombre] = d.sid
    if (d.type === "cc-busco" && cc.salidas[d.nombre]) anunciar(d.nombre)
    if (d.type === "cc-quien") anunciar()
  }

  const alMensaje = async (m) => {
    if (!m || m.type !== "cc" || !m.message) return
    const de = m.id
    const { que, desc, nombre, canal } = m.message
    try {
      if (que === "oferta" && cc.salidas[nombre]) {
        const llave = de + "|" + canal
        if (cc.salientes[llave]) cc.salientes[llave].close()
        const pc = new RTCPeerConnection(ice())
        cc.salientes[llave] = pc
        const flujo = cc.salidas[nombre]
        flujo.getTracks().forEach(t => pc.addTrack(t, flujo))
        await pc.setRemoteDescription(desc)
        await pc.setLocalDescription(await pc.createAnswer())
        await listo(pc)
        sg.emit("message", { id: de, type: "cc", message: { que: "respuesta", nombre, canal, desc: pc.localDescription } })
      }
      if (que === "respuesta" && cc.entrantes[canal]) {
        const pc = cc.entrantes[canal].pc
        if (pc && pc.signalingState === "have-local-offer") await pc.setRemoteDescription(desc)
      }
    } catch (e) { console.log("taller:", e.message) }
  }

  sg.on("broadcast", alDifundir)
  sg.on("message", alMensaje)
  const alConectar = () => anunciar()
  sg.on("connect", alConectar)

  // pide una transmisión por su nombre y avisa cuando llega el video
  const pedir = (nombre, alLlegar) => {
    const canal = "c" + (++cc.n) + Math.random().toString(36).slice(2, 7)
    const en = { nombre, pc: null, timer: null, intentando: false, video: null, desde: 0 }
    cc.entrantes[canal] = en

    const conectar = async () => {
      if (en.intentando) return
      const estado = en.pc ? en.pc.connectionState : "nada"
      if (estado === "connected") return
      if ((estado === "new" || estado === "connecting") && Date.now() - en.desde < 12000) return
      if (estado !== "nada") { delete cc.dir[nombre]; en.pc.close(); en.pc = null }
      const sid = cc.dir[nombre]
      if (!sid) { aviso("buscando a " + nombre + "..."); sg.emit("broadcast", { type: "cc-busco", nombre }); return }
      en.intentando = true
      en.desde = Date.now()
      try {
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
          aviso("recibiendo a " + nombre)
          alLlegar(v)
        }
        await pc.setLocalDescription(await pc.createOffer())
        await listo(pc)
        sg.emit("message", { id: sid, type: "cc", message: { que: "oferta", nombre, canal, desc: pc.localDescription } })
      } catch (e) { console.log("taller:", e.message) }
      en.intentando = false
    }
    conectar()
    en.timer = setInterval(conectar, 2500)
    en.cerrar = () => { clearInterval(en.timer); if (en.pc) en.pc.close(); delete cc.entrantes[canal] }
    return en
  }

  // ---------- transmitir ----------
  const pantalla = () => pb.stream || document.querySelector("canvas").captureStream(25)

  // convierte una fuente de Hydra (s0, s1...) en una transmisión liviana
  const flujoDeFuente = (fuente) => {
    const c = document.createElement("canvas")
    c.width = 640
    c.height = 360
    const g = c.getContext("2d")
    const t = setInterval(() => {
      const el = fuente.src
      if (!el) return
      const w = el.videoWidth || el.naturalWidth || el.width
      const h = el.videoHeight || el.naturalHeight || el.height
      if (!w || !h) return
      const alto = Math.round(640 * h / w / 2) * 2
      if (c.height !== alto) c.height = alto
      try { g.drawImage(el, 0, 0, c.width, c.height) } catch (e) {}
    }, 80)
    cc.timers.push(t)
    return c.captureStream(12)
  }

  window.compartir = (nombre, fuente) => {
    const n = norm(nombre)
    if (fuente) {
      if (!cc.salidas[n] || cc.salidas[n].__fuente !== fuente) {
        cc.salidas[n] = flujoDeFuente(fuente)
        cc.salidas[n].__fuente = fuente
      }
      if (!cc.salidas[n + "-pantalla"]) cc.salidas[n + "-pantalla"] = pantalla()
      aviso("compartiendo: " + n + " (tu imagen) y " + n + "-pantalla (tu pantalla)")
    } else {
      if (!cc.salidas[n]) cc.salidas[n] = pantalla()
      aviso("compartiendo tu pantalla como: " + n)
    }
    anunciar()
  }

  // ---------- recibir ----------
  window.recibir = (fuente, nombre) => {
    const n = norm(nombre)
    const previo = Object.values(cc.entrantes).find(e => e.fuente === fuente)
    if (previo && previo.nombre === n) {
      if (previo.video) fuente.init({ src: previo.video, dynamic: true })
      return
    }
    if (previo) previo.cerrar()
    const en = pedir(n, (v) => fuente.init({ src: v, dynamic: true }))
    en.fuente = fuente
  }

  // ---------- ver: ventanita para mirar una transmisión sin tocar tu código ----------
  const estante = document.createElement("div")
  estante.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:flex-end"
  document.body.appendChild(estante)

  window.ver = (nombre) => {
    const n = norm(nombre)
    if (cc.vistas[n]) return
    const marco = document.createElement("div")
    marco.style.cssText = "width:280px;background:#000;border:1px solid #fff;border-radius:6px;overflow:hidden;font:12px monospace;color:#fff"
    const barra = document.createElement("div")
    barra.style.cssText = "display:flex;justify-content:space-between;padding:4px 8px;background:rgba(255,255,255,.15)"
    const titulo = document.createElement("span")
    titulo.textContent = n
    const x = document.createElement("span")
    x.textContent = "cerrar"
    x.style.cssText = "cursor:pointer;text-decoration:underline"
    barra.appendChild(titulo)
    barra.appendChild(x)
    const hueco = document.createElement("div")
    hueco.style.cssText = "min-height:60px"
    marco.appendChild(barra)
    marco.appendChild(hueco)
    estante.appendChild(marco)
    const en = pedir(n, (v) => {
      v.style.cssText = "display:block;width:100%"
      hueco.innerHTML = ""
      hueco.appendChild(v)
    })
    cc.vistas[n] = { marco, en }
    x.onclick = () => { en.cerrar(); marco.remove(); delete cc.vistas[n] }
  }

  // ---------- cargar: imagen o video desde tu computador ----------
  const usarArchivo = (fuente, archivo) => {
    const url = URL.createObjectURL(archivo)
    if (archivo.type.startsWith("video")) {
      const v = document.createElement("video")
      v.muted = true
      v.loop = true
      v.playsInline = true
      v.src = url
      v.addEventListener("loadeddata", () => {
        v.play().catch(() => {})
        cc.archivos.set(fuente, v)
        fuente.init({ src: v, dynamic: true })
        aviso("video cargado: " + archivo.name)
      }, { once: true })
    } else {
      const img = new Image()
      img.onload = () => {
        cc.archivos.set(fuente, img)
        fuente.init({ src: img, dynamic: false })
        aviso("imagen cargada: " + archivo.name)
      }
      img.src = url
    }
  }
  cc.usarArchivo = usarArchivo

  window.cargar = (fuente, modo) => {
    const previo = cc.archivos.get(fuente)
    if (previo && modo !== "cambiar") {
      fuente.init({ src: previo, dynamic: previo.tagName === "VIDEO" })
      return
    }
    if (cc.boton) cc.boton.remove()
    const boton = document.createElement("label")
    boton.textContent = "Haz clic aquí para elegir tu imagen o video"
    boton.style.cssText = "position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:99999;font:18px monospace;color:#000;background:#fff;padding:18px 26px;border-radius:8px;cursor:pointer;box-shadow:0 0 0 4px #f050f0"
    const entrada = document.createElement("input")
    entrada.type = "file"
    entrada.accept = "image/*,video/*"
    entrada.style.display = "none"
    entrada.addEventListener("change", () => {
      if (entrada.files && entrada.files[0]) usarArchivo(fuente, entrada.files[0])
      boton.remove()
      cc.boton = null
    })
    boton.appendChild(entrada)
    document.body.appendChild(boton)
    cc.boton = boton
    cc.entrada = entrada
  }

  window.quienes = () => {
    sg.emit("broadcast", { type: "cc-quien" })
    setTimeout(() => {
      const todos = [...new Set([...Object.keys(cc.dir), ...Object.keys(cc.salidas)])].sort()
      aviso("compartiendo ahora: " + (todos.join(", ") || "nadie todavía"))
    }, 1500)
  }

  cc.cerrar = () => {
    sg.off("broadcast", alDifundir)
    sg.off("message", alMensaje)
    sg.off("connect", alConectar)
    Object.values(cc.entrantes).forEach(e => { clearInterval(e.timer); if (e.pc) e.pc.close() })
    Object.values(cc.salientes).forEach(pc => pc.close())
    cc.timers.forEach(clearInterval)
    caja.remove()
    estante.remove()
    if (cc.boton) cc.boton.remove()
  }

  aviso("taller listo")
})()
