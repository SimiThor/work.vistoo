import SwiftUI
import VistooCore

enum TimelineScale: String, CaseIterable, Identifiable {
    case day, week
    var id: String { rawValue }
    var label: String { self == .day ? "Tage" : "Wochen" }
    /// Points per calendar day (web: 36 / 14 px).
    var dayWidth: CGFloat { self == .day ? 36 : 14 }
}

/// Timeline/Gantt for the narrow screen.
///
/// - Task names sit above their bar in full width and stay pinned to the left
///   edge while the time axis scrolls horizontally (readable on iPhone).
/// - Zoom (Tage/Wochen) and "Heute" sit in a bottom bar within thumb reach.
/// - Tapping a row opens the task; dates are edited with native date pickers.
/// - Tasks without a complete range are listed above ("Termine setzen").
struct TimelineView: View {
    let session: SessionModel
    let scope: WorkScope
    let tasks: [TaskItem]
    let onOpen: (TaskItem, _ focusDates: Bool) -> Void

    @AppStorage("vistoo.timeline.scale") private var scaleRaw = TimelineScale.day.rawValue
    @State private var position = ScrollPosition(edge: .leading)
    @State private var scrollX: CGFloat = 0
    @State private var showUnplanned = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var work: WorkStore { session.work }
    private var scale: TimelineScale { TimelineScale(rawValue: scaleRaw) ?? .day }
    private var today: CalendarDate { .today() }

    private var planned: [TaskItem] {
        tasks.filter(\.hasCompleteRange).sorted {
            ($0.startDate!, $0.endDate!, $0.title) < ($1.startDate!, $1.endDate!, $1.title)
        }
    }
    private var unplanned: [TaskItem] { tasks.filter { !$0.hasCompleteRange } }

    /// Visible range: always Monday-aligned, padded around today and all bars.
    private var range: (start: CalendarDate, days: Int) {
        var minDay = today.dayNumber
        var maxDay = today.dayNumber
        for t in planned {
            minDay = min(minDay, t.startDate!.dayNumber)
            maxDay = max(maxDay, t.endDate!.dayNumber)
        }
        let start = CalendarDate(dayNumber: minDay - (scale == .day ? 7 : 14)).startOfWeek
        let end = CalendarDate(dayNumber: maxDay + (scale == .day ? 21 : 56)).startOfWeek.adding(days: 6)
        return (start, end.dayNumber - start.dayNumber + 1)
    }

    private enum Row: Identifiable {
        case header(id: String, label: String, color: String?)
        case task(TaskItem)
        var id: String {
            switch self {
            case .header(let id, _, _): "h-\(id)"
            case .task(let t): t.id
            }
        }
    }

    private var rows: [Row] {
        var out: [Row] = []
        switch scope {
        case .all:
            let byProject = Dictionary(grouping: planned, by: \.projectId)
            let ordered = byProject.keys.sorted {
                (work.project($0)?.name ?? "").localizedCaseInsensitiveCompare(work.project($1)?.name ?? "") == .orderedAscending
            }
            for pid in ordered {
                let p = work.project(pid)
                out.append(.header(id: pid, label: p?.name ?? "Projekt", color: p?.color))
                out += byProject[pid]!.map(Row.task)
            }
        case .project(let id):
            let groups = work.project(id)?.groups ?? []
            let known = Set(groups.map(\.id))
            for g in groups {
                let list = planned.filter { $0.groupId == g.id }
                guard !list.isEmpty else { continue }
                out.append(.header(id: g.id, label: g.name, color: nil))
                out += list.map(Row.task)
            }
            let ungrouped = planned.filter { $0.groupId == nil || !known.contains($0.groupId!) }
            if !ungrouped.isEmpty {
                if out.contains(where: { if case .header = $0 { true } else { false } }) {
                    out.append(.header(id: "none", label: "Ohne Gruppe", color: nil))
                }
                out += ungrouped.map(Row.task)
            }
        }
        return out
    }

    var body: some View {
        VStack(spacing: 0) {
            if !unplanned.isEmpty { unplannedSection }
            if planned.isEmpty {
                ContentUnavailableView(
                    "Nichts geplant",
                    systemImage: "calendar.badge.plus",
                    description: Text("Keine Aufgabe hat bisher einen vollständigen Zeitraum. Öffne eine Aufgabe und setze Start- und Enddatum.")
                )
            } else {
                chart
            }
        }
        .safeAreaInset(edge: .bottom) { controls }
    }

    // MARK: Chart

    private var chart: some View {
        let (start, days) = range
        let W = scale.dayWidth
        let width = CGFloat(days) * W
        let todayX = CGFloat(today.dayNumber - start.dayNumber) * W
        return ScrollView([.horizontal, .vertical]) {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                Section {
                    ForEach(rows) { row in
                        switch row {
                        case .header(_, let label, let color):
                            HStack(spacing: Tokens.Spacing.sm) {
                                if let color { ProjectDot(colorKey: color) }
                                Text(label).font(.footnote.weight(.semibold)).foregroundStyle(Tokens.Palette.mutedForeground)
                            }
                            .padding(.horizontal, Tokens.Spacing.lg)
                            .padding(.top, Tokens.Spacing.md)
                            .padding(.bottom, Tokens.Spacing.xs)
                            .offset(x: max(0, scrollX))
                            .frame(width: width, alignment: .leading)
                            .accessibilityAddTraits(.isHeader)
                        case .task(let task):
                            TimelineRow(
                                task: task, start: start, dayWidth: W, width: width, todayX: todayX, scrollX: scrollX
                            ) { onOpen(task, false) }
                        }
                    }
                } header: {
                    TimelineHeader(start: start, days: days, scale: scale, today: today)
                }
            }
            .frame(width: width, alignment: .leading)
            .background(alignment: .topLeading) { WeekendGrid(start: start, days: days, dayWidth: W) }
        }
        .scrollPosition($position)
        .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.x } action: { _, x in scrollX = x }
        .onAppear { scrollToToday(animated: false) }
        .onChange(of: scaleRaw) { _, _ in scrollToToday(animated: false) }
        .accessibilityLabel("Zeitachse")
    }

    private func scrollToToday(animated: Bool) {
        let (start, _) = range
        let x = max(0, CGFloat(today.dayNumber - start.dayNumber) * scale.dayWidth - 80)
        if animated, !reduceMotion {
            withAnimation { position.scrollTo(x: x) }
        } else {
            position.scrollTo(x: x)
        }
    }

    private var controls: some View {
        HStack(spacing: Tokens.Spacing.md) {
            Picker("Zoom", selection: $scaleRaw) {
                ForEach(TimelineScale.allCases) { Text($0.label).tag($0.rawValue) }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 200)
            Spacer()
            Button {
                scrollToToday(animated: true)
            } label: {
                Label("Heute", systemImage: "calendar.day.timeline.left")
            }
            .buttonStyle(.bordered)
            .disabled(planned.isEmpty)
        }
        .padding(.horizontal, Tokens.Spacing.lg)
        .padding(.vertical, Tokens.Spacing.sm)
        .background(.bar)
    }

    // MARK: Unplanned

    private var unplannedSection: some View {
        DisclosureGroup(isExpanded: $showUnplanned) {
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(unplanned) { task in
                        HStack(spacing: Tokens.Spacing.sm) {
                            StatusIcon(status: task.status)
                            Button(task.title) { onOpen(task, false) }
                                .buttonStyle(.plain)
                                .lineLimit(2)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            if !work.isReadOnly(task) {
                                Button {
                                    onOpen(task, true)
                                } label: {
                                    Label("Termine setzen", systemImage: "calendar.badge.plus").labelStyle(.iconOnly)
                                }
                                .accessibilityLabel("Termine für „\(task.title)“ setzen")
                            }
                        }
                        .padding(.vertical, Tokens.Spacing.sm)
                        Divider()
                    }
                }
            }
            .frame(maxHeight: 180)
        } label: {
            HStack {
                Text("Nicht vollständig geplant").font(.subheadline.weight(.semibold))
                Text("\(unplanned.count)").foregroundStyle(Tokens.Palette.mutedForeground)
            }
        }
        .padding(.horizontal, Tokens.Spacing.lg)
        .padding(.vertical, Tokens.Spacing.sm)
        .background(Tokens.Palette.surfaceSubtle)
    }
}

/// Title row + bar. The title is pinned to the visible left edge.
private struct TimelineRow: View {
    let task: TaskItem
    let start: CalendarDate
    let dayWidth: CGFloat
    let width: CGFloat
    let todayX: CGFloat
    let scrollX: CGFloat
    let open: () -> Void

    var body: some View {
        let s = task.startDate!, e = task.endDate!
        let left = CGFloat(s.dayNumber - start.dayNumber) * dayWidth
        let barWidth = max(CGFloat(e.dayNumber - s.dayNumber + 1) * dayWidth - 4, dayWidth - 4)
        Button(action: open) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    StatusIcon(status: task.status, size: 13)
                    Text(task.title).font(.subheadline).lineLimit(1)
                    Text(Formatting.range(s, e)).font(.caption).foregroundStyle(Tokens.Palette.mutedForeground).lineLimit(1)
                }
                .padding(.horizontal, Tokens.Spacing.lg)
                .frame(maxWidth: 340, alignment: .leading)
                .offset(x: max(0, scrollX))
                ZStack(alignment: .leading) {
                    Color.clear.frame(width: width, height: 14)
                    Rectangle().fill(Tokens.Palette.accentBlue.opacity(0.7)).frame(width: 2, height: 22)
                        .offset(x: todayX + dayWidth / 2 - 1)
                    RoundedRectangle(cornerRadius: Tokens.Radius.sm, style: .continuous)
                        .fill(fill)
                        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.sm, style: .continuous).strokeBorder(stroke))
                        .frame(width: barWidth, height: 14)
                        .offset(x: left + 2)
                }
            }
            .padding(.vertical, 6)
            .frame(width: width, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "\(task.title), \(s == e ? Formatting.long(s) : "\(Formatting.long(s)) bis \(Formatting.long(e))"), "
                + "\(CalendarDate.durationDays(from: s, to: e) == 1 ? "1 Tag" : "\(CalendarDate.durationDays(from: s, to: e)) Tage"), "
                + "Status \(task.status.label)"
        )
        .accessibilityHint("Öffnet die Details")
    }

    private var fill: Color {
        switch task.status {
        case .open: Tokens.Palette.timelineOpenBg
        case .inProgress: Tokens.Palette.accentBlueSoft
        case .inReview: Tokens.Palette.timelineReviewBg
        default: Tokens.Palette.surfaceSubtle
        }
    }

    private var stroke: Color {
        switch task.status {
        case .open: Tokens.Palette.timelineOpenBorder
        case .inProgress: Tokens.Palette.timelineProgressBorder
        case .inReview: Tokens.Palette.timelineReviewBorder
        default: Tokens.Palette.border
        }
    }
}

private struct TimelineHeader: View {
    let start: CalendarDate
    let days: Int
    let scale: TimelineScale
    let today: CalendarDate

    var body: some View {
        let W = scale.dayWidth
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                ForEach(months, id: \.from) { m in
                    Text(CGFloat(m.length) * W > 70 ? m.label : "")
                        .font(.caption.weight(.medium))
                        .lineLimit(1)
                        .padding(.leading, 6)
                        .frame(width: CGFloat(m.length) * W, alignment: .leading)
                }
            }
            .frame(height: 22)
            HStack(spacing: 0) {
                if scale == .day {
                    ForEach(0..<days, id: \.self) { i in
                        let d = start.adding(days: i)
                        VStack(spacing: 1) {
                            Text(weekday(d)).font(.system(size: 9))
                            Text("\(d.components.day)")
                                .font(.system(size: 11).monospacedDigit())
                                .frame(width: 20, height: 20)
                                .background(Circle().fill(d == today ? Tokens.Palette.accentBlue : .clear))
                                .foregroundStyle(d == today ? .white : Tokens.Palette.foreground)
                        }
                        .foregroundStyle(Tokens.Palette.mutedForeground)
                        .frame(width: W)
                    }
                } else {
                    ForEach(0..<((days + 6) / 7), id: \.self) { i in
                        let d = start.adding(days: i * 7)
                        let containsToday = today >= d && today < d.adding(days: 7)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("KW \(d.isoWeek)").font(.system(size: 9, weight: .medium))
                            Text("\(d.components.day).\(d.components.month).").font(.system(size: 9).monospacedDigit())
                        }
                        .foregroundStyle(containsToday ? Tokens.Palette.accentBlueText : Tokens.Palette.mutedForeground)
                        .padding(.leading, 4)
                        .frame(width: 7 * W, alignment: .leading)
                    }
                }
            }
            .frame(height: 34)
            Divider()
        }
        .background(Tokens.Palette.background)
        .accessibilityHidden(true)
    }

    private var months: [(label: String, from: Int, length: Int)] {
        var out: [(String, Int, Int)] = []
        for i in 0..<days {
            let label = Formatting.monthYear(start.adding(days: i))
            if let last = out.last, last.0 == label { out[out.count - 1].2 += 1 } else { out.append((label, i, 1)) }
        }
        return out.map { (label: $0.0, from: $0.1, length: $0.2) }
    }

    private func weekday(_ d: CalendarDate) -> String {
        ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"][d.weekdayIndex]
    }
}

/// Weekend shading and week separators behind the rows.
private struct WeekendGrid: View {
    let start: CalendarDate
    let days: Int
    let dayWidth: CGFloat

    var body: some View {
        Canvas { context, size in
            for i in 0..<days {
                let d = start.adding(days: i)
                let x = CGFloat(i) * dayWidth
                if d.isWeekend {
                    context.fill(Path(CGRect(x: x, y: 0, width: dayWidth, height: size.height)), with: .color(Tokens.Palette.surfaceSubtle))
                }
                if d.weekdayIndex == 0 {
                    context.fill(Path(CGRect(x: x, y: 0, width: 1, height: size.height)), with: .color(Tokens.Palette.border))
                }
            }
        }
        .frame(width: CGFloat(days) * dayWidth)
        .frame(maxHeight: .infinity)
        .accessibilityHidden(true)
    }
}

extension Formatting {
    static func monthYear(_ date: CalendarDate) -> String {
        Date.FormatStyle(date: .omitted, time: .omitted, locale: locale, timeZone: utc).month(.wide).year().format(date.utcMidnight)
    }
}
