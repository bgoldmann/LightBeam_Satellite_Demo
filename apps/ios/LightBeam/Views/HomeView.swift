import SwiftUI

struct HomeView: View {
    var body: some View {
        List {
            Section {
                Text("home.tagline")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text("offline.notice")
                    .font(.caption)
                    .foregroundStyle(.cyan)
            }

            Section("home.actions") {
                NavigationLink {
                    LiveScannerView()
                } label: {
                    Label("home.scanTV", systemImage: "dot.radiowaves.left.and.right")
                }

                NavigationLink {
                    DecodeVideoView()
                } label: {
                    Label("home.decodeVideo", systemImage: "film")
                }

                NavigationLink {
                    RecoveredFilesView()
                } label: {
                    Label("home.recoveredFiles", systemImage: "folder")
                }
            }

            Section("home.learn") {
                NavigationLink {
                    HowItWorksView()
                } label: {
                    Label("home.howItWorks", systemImage: "questionmark.circle")
                }

                NavigationLink {
                    SafetyView()
                } label: {
                    Label("home.safety", systemImage: "shield.checkered")
                }

                NavigationLink {
                    SettingsView()
                } label: {
                    Label("home.settings", systemImage: "gearshape")
                }
            }
        }
        .navigationTitle("app.name")
    }
}
