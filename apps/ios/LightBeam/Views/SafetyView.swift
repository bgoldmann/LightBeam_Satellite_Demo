import SwiftUI

struct SafetyView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("safety.intro")
                bullet("safety.verifyHash")
                bullet("safety.offline")
                bullet("safety.publisher")
                bullet("safety.demo")
                Text("offline.notice")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top)
            }
            .padding()
        }
        .navigationTitle("home.safety")
    }

    private func bullet(_ key: LocalizedStringKey) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text("•")
            Text(key)
        }
    }
}
