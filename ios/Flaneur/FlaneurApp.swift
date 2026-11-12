import SwiftUI

@main
struct FlaneurApp: App {
    @AppStorage("seenIntro") private var seenIntro = false
    var body: some Scene {
        WindowGroup {
            if seenIntro {
                MapScreen().ignoresSafeArea(edges: .bottom)
            } else {
                IntroView { seenIntro = true }
            }
        }
    }
}

extension Color {
    static let evergreen = Color(red: 0x1F/255, green: 0x3D/255, blue: 0x2B/255)
    static let marigold = Color(red: 0xF2/255, green: 0xA5/255, blue: 0x41/255)
    static let cream = Color(red: 0xFB/255, green: 0xF6/255, blue: 0xEC/255)
}

struct IntroView: View {
    var onDone: () -> Void
    var body: some View {
        ZStack {
            Color.evergreen.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 18) {
                Spacer()
                Image("IntroMark").resizable().frame(width: 84, height: 84).clipShape(RoundedRectangle(cornerRadius: 20))
                Text("Flâneur").font(.system(size: 48, weight: .bold, design: .serif)).foregroundStyle(Color.cream)
                Text("Take the scenic route.").font(.system(.title2, design: .serif).italic()).foregroundStyle(Color.marigold)
                Text("Two extra minutes can take you past a park, a beautiful building, and a street full of life. Flâneur finds that walk for you.")
                    .font(.body).foregroundStyle(Color.cream.opacity(0.85))
                Spacer()
                Button(action: onDone) {
                    Text("Start wandering").font(.headline).frame(maxWidth: .infinity).padding()
                        .background(Color.marigold).foregroundStyle(Color.evergreen).clipShape(RoundedRectangle(cornerRadius: 16))
                }
            }.padding(28)
        }
    }
}
