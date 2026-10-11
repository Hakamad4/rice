import AVFoundation

/// Passa 1 s de seno por Resampler + Chunker + StdoutFrameSink, como o ScreenCaptureKit
/// entregaria (48 kHz, estéreo, float32 não intercalado).
func runToneSelfTest() {
    let sink = StdoutFrameSink()
    let format = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 2)!
    let block = 4800

    for (source, frequency) in [(AudioSource.mic, 440.0), (AudioSource.sys, 880.0)] {
        let resampler = Resampler()
        let chunker = Chunker(source: source, sink: sink)
        for index in 0..<10 {
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(block))!
            buffer.frameLength = AVAudioFrameCount(block)
            for channel in 0..<2 {
                let samples = buffer.floatChannelData![channel]
                for i in 0..<block {
                    let t = Double(index * block + i) / 48_000
                    samples[i] = Float(0.5 * sin(2 * Double.pi * frequency * t))
                }
            }
            chunker.append(resampler.convert(buffer), nowMs: 0)
        }
        chunker.flush()
    }
    sink.drain()
}

/// 2 s de seno (20 blocos de 100 ms) com um buraco de 1 s no relógio entre os blocos 10 e 11.
/// Só a fonte mic. Esperado: ~3 s de áudio (silêncio cobrindo o buraco) e um evento "gap".
func runGapSelfTest() {
    let sink = StdoutFrameSink()
    let chunker = Chunker(source: .mic, sink: sink)
    let block = 1600
    for index in 0..<20 {
        let samples = (0..<block).map { i -> Int16 in
            let t = Double(index * block + i) / 16_000
            return Int16(0.5 * 32767 * sin(2 * Double.pi * 440 * t))
        }
        let nowMs = UInt64(index + 1) * 100 + (index >= 10 ? 1000 : 0)
        chunker.append(samples, nowMs: nowMs)
    }
    chunker.flush()
    sink.drain()
}

/// 6 s de ruído modulado (parecido com fala) tocando "no sistema" e chegando ao mic atrasado
/// 40 ms, atenuado e com um eco de sala. Imprime em JSON a redução de energia do mic nos
/// último 1 s (depois de o AEC3 convergir e da fala local) e quanto de uma "voz local" (presente só
/// entre 3,5 s e 4,5 s, falando junto com o sistema) sobrevive. Sem stdout de frames.
func runAecSelfTest() {
    guard let aec = EchoCanceller() else {
        print(#"{"error":"falha ao criar o AEC"}"#)
        return
    }
    let rate = 16_000
    let total = rate * 6
    var generator = SystemRandomNumberGenerator()
    var reference = [Int16](repeating: 0, count: total)
    var lowpass = 0.0
    for i in 0..<total {
        let t = Double(i) / Double(rate)
        let envelope = 0.5 + 0.5 * sin(2 * Double.pi * 3 * t) // sílabas ~3 Hz
        let noise = Double.random(in: -1...1, using: &generator)
        lowpass += 0.3 * (noise - lowpass)
        let tone = 0.3 * sin(2 * Double.pi * 220 * t) + 0.2 * sin(2 * Double.pi * 660 * t)
        reference[i] = Int16(max(-32767, min(32767, 12_000 * envelope * (lowpass + tone))))
    }
    var mic = [Int16](repeating: 0, count: total)
    for i in 0..<total {
        var value = 0.0
        if i >= 640 { value += 0.5 * Double(reference[i - 640]) }
        if i >= 960 { value += 0.2 * Double(reference[i - 960]) }
        mic[i] = Int16(max(-32767, min(32767, value)))
    }
    // Voz local: tom de 300 Hz com harmônicos, modulado, entre 3,5 s e 4,5 s.
    let voiceStart = rate * 7 / 2, voiceEnd = rate * 9 / 2
    var voice = [Int16](repeating: 0, count: total)
    for i in voiceStart..<voiceEnd {
        let t = Double(i) / Double(rate)
        let envelope = 0.6 + 0.4 * sin(2 * Double.pi * 4 * t)
        let value = 6_000 * envelope * (sin(2 * Double.pi * 300 * t) + 0.5 * sin(2 * Double.pi * 900 * t))
        voice[i] = Int16(value)
        mic[i] = Int16(max(-32767, min(32767, Int(mic[i]) + Int(voice[i]))))
    }
    var output: [Int16] = []
    let frame = EchoCanceller.frameSamples
    for start in stride(from: 0, to: total, by: frame) {
        aec.pushRender(Array(reference[start..<start + frame]))
        output.append(contentsOf: aec.processCapture(Array(mic[start..<start + frame])))
    }
    func energyDb(_ samples: ArraySlice<Int16>) -> Double {
        let sum = samples.reduce(0.0) { $0 + Double($1) * Double($1) }
        return 10 * log10(sum / Double(samples.count) + 1e-9)
    }
    let tail = total - rate // último 1 s, depois da fala local
    let inDb = energyDb(mic[tail..<total])
    let outDb = energyDb(output[tail..<min(total, output.count)])
    // Ignora os primeiros 100 ms da voz (o AEC leva um instante para notar a fala local).
    let voiceWindow = (voiceStart + rate / 10)..<voiceEnd
    let voiceLossDb = energyDb(voice[voiceWindow]) - energyDb(output[voiceWindow])
    print(String(format: #"{"inDb":%.1f,"outDb":%.1f,"reductionDb":%.1f,"voiceLossDb":%.1f}"#, inDb, outDb, inDb - outDb, voiceLossDb))
}
