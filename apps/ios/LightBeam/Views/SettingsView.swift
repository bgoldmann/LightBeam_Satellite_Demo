import SwiftUI

struct SettingsView: View {
    @AppStorage("preferredLanguageTag") private var preferredLanguageTag = "system"

    var body: some View {
        Form {
            Section("settings.language") {
                Picker("settings.language", selection: $preferredLanguageTag) {
                    Text("settings.language.system").tag("system")
                    Text("English").tag("en")
                    Text("فارسی").tag("fa")
                }
                Text("settings.language.note")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("settings.about") {
                LabeledContent("settings.bundleId", value: "com.goldmannllc.LightBeam")
                LabeledContent("settings.protocol", value: "LBOP/1")
            }

            Section {
                Text("offline.notice")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("home.settings")
    }
}
