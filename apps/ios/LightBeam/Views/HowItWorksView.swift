import SwiftUI

struct HowItWorksView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("how.intro")
                bullet("how.step1")
                bullet("how.step2")
                bullet("how.step3")
                bullet("how.step4")
                Text("offline.notice")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top)
            }
            .padding()
        }
        .navigationTitle("home.howItWorks")
    }

    private func bullet(_ key: LocalizedStringKey) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text("•")
            Text(key)
        }
    }
}
