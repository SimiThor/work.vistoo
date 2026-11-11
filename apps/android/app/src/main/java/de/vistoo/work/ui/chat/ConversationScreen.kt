package de.vistoo.work.ui.chat

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import de.vistoo.work.ui.components.rememberMainScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.generated.Attachment
import de.vistoo.work.core.generated.ChatPerson
import de.vistoo.work.core.generated.ConversationDetail
import de.vistoo.work.core.generated.ConversationKind
import de.vistoo.work.core.generated.Limits
import de.vistoo.work.core.generated.Message
import de.vistoo.work.core.generated.ReadOnlyReason
import de.vistoo.work.core.stores.ComposerAttachment
import de.vistoo.work.core.stores.ConversationModel
import de.vistoo.work.core.stores.LoadState
import de.vistoo.work.core.stores.PendingMessage
import de.vistoo.work.core.stores.SessionModel
import de.vistoo.work.core.support.ByteFormatting
import de.vistoo.work.ui.components.ActionFailure
import de.vistoo.work.ui.components.Avatar
import de.vistoo.work.ui.components.ConfirmDialog
import de.vistoo.work.ui.components.EntryMenu
import de.vistoo.work.ui.components.FailureAlert
import de.vistoo.work.ui.components.FailureView
import de.vistoo.work.ui.components.FormSheet
import de.vistoo.work.ui.components.FormTextField
import de.vistoo.work.ui.components.Formatting
import de.vistoo.work.ui.components.GroupedList
import de.vistoo.work.ui.components.LoadingView
import de.vistoo.work.ui.components.MenuEntry
import de.vistoo.work.ui.components.MenuTarget
import de.vistoo.work.ui.components.SmallProgress
import de.vistoo.work.ui.components.VistooTopBar
import de.vistoo.work.ui.components.cardSurface
import de.vistoo.work.ui.components.displayName
import de.vistoo.work.ui.components.section
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.theme.VType
import java.io.ByteArrayOutputStream
import java.io.File
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * One conversation: newest at the bottom (reversed list, so older pages prepend without
 * jumps), composer above the keyboard, attachments via the system pickers, files opened
 * via the system viewer (which offers sharing).
 */
@Composable
fun ConversationScreen(session: SessionModel, conversationId: String, onBack: () -> Unit) {
    val model = remember(conversationId) { session.chat.model(conversationId) }
    val context = LocalContext.current
    val scope = rememberMainScope()
    var showDetails by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Message?>(null) }
    var deleting by remember { mutableStateOf<Message?>(null) }
    var downloading by remember { mutableStateOf<String?>(null) }
    var failure by remember { mutableStateOf<ActionFailure?>(null) }
    val listState = rememberLazyListState()
    val limits = session.limits
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    // Visible only while on screen and in the foreground (read state, realtime subscription).
    DisposableEffect(conversationId) {
        model.screenAppeared()
        session.watchConversation(conversationId)
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) model.foregroundChanged(true)
            if (event == Lifecycle.Event.ON_STOP) model.foregroundChanged(false)
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            model.screenDisappeared()
            // Only if no newer screen subscribed to another (or the same) conversation meanwhile.
            if (!model.isVisible) session.unwatchConversation(conversationId)
        }
    }
    LaunchedEffect(conversationId) { if (model.state == LoadState.Loaded) model.catchUp() else model.load() }

    // Reversed layout: index 0 is the newest item.
    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset < 80 }
            .distinctUntilChanged()
            .collect { model.isAtBottom = it }
    }
    LaunchedEffect(listState) {
        snapshotFlow {
            val info = listState.layoutInfo
            (info.visibleItemsInfo.lastOrNull()?.index ?: 0) >= info.totalItemsCount - 3
        }.distinctUntilChanged().collect { nearTop -> if (nearTop && model.hasOlder) model.loadOlder() }
    }
    // Follow new messages only when the reader is already at the end; always for own sends.
    LaunchedEffect(model.messages.lastOrNull()?.id, model.pending.size) {
        if (model.isAtBottom || model.pending.isNotEmpty()) listState.animateScrollToItem(0)
    }

    val photoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(maxOf(2, limits.maxFilesPerMessage.toInt()))) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch { addPhotos(context, model, uris, limits) { failure = it } }
    }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch { addFiles(context, model, uris, limits) { failure = it } }
    }

    fun open(attachment: Attachment, share: Boolean = false) {
        if (downloading != null) return
        downloading = attachment.id
        scope.launch {
            try {
                val file = model.download(attachment)
                openFile(context, file, attachment.mimeType, share)
            } catch (e: ApiError) {
                failure = ActionFailure.of("Datei nicht geöffnet", e)
            } catch (_: android.content.ActivityNotFoundException) {
                failure = ActionFailure("Datei nicht geöffnet", "Auf diesem Gerät ist keine App installiert, die diese Datei öffnen kann.")
            } finally {
                downloading = null
            }
        }
    }

    Scaffold(
        containerColor = Tokens.Palette.background,
        topBar = {
            VistooTopBar(model.detail?.title ?: session.chat.summary(conversationId)?.title ?: "Unterhaltung", onBack = onBack, actions = {
                IconButton(onClick = { showDetails = true }, enabled = model.detail != null) { Icon(Icons.Outlined.Info, "Details") }
            })
        },
        bottomBar = {
            Box(Modifier.navigationBarsPadding().imePadding()) {
                val detail = model.detail
                if (detail != null && !detail.canPost) {
                    Row(
                        Modifier.fillMaxWidth().background(Tokens.Palette.surfaceSubtle).padding(16.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Outlined.Lock, null, tint = Tokens.Palette.mutedForeground, modifier = Modifier.size(16.dp))
                        Text(
                            if (detail.readOnlyReason == ReadOnlyReason.Archived) "Dieser Kanal ist archiviert. Neue Nachrichten sind nicht möglich."
                            else "Diese Person ist kein aktives Mitglied mehr. Die Unterhaltung ist schreibgeschützt.",
                            style = VType.footnote,
                            color = Tokens.Palette.mutedForeground,
                            modifier = Modifier.padding(start = 6.dp),
                        )
                    }
                } else if (detail != null) {
                    Composer(
                        model, limits,
                        onPhotos = { photoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                        onFiles = { filePicker.launch(allowedMimeTypes(limits)) },
                        onSend = { scope.launch { model.send() } },
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            val state = model.state
            if (model.messages.isEmpty() && state != LoadState.Loaded) {
                if (state is LoadState.Failed) FailureView(state.message) { model.load() } else LoadingView()
            } else {
                val messages = model.messages
                LazyColumn(Modifier.fillMaxSize(), state = listState, reverseLayout = true, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp)) {
                    items(model.pending.reversed(), key = { "p-${it.id}" }) { p ->
                        PendingMessageRow(p, retry = { scope.launch { model.retry(p.id) } }, discard = { model.discard(p.id) })
                    }
                    for (i in messages.indices.reversed()) {
                        val message = messages[i]
                        val previous = messages.getOrNull(i - 1)
                        item(key = message.id) {
                            val compact = previous != null && previous.authorId == message.authorId &&
                                message.createdAt.epochSecond - previous.createdAt.epochSecond < 300
                            MenuTarget({ messageMenu(context, session, model, message, { editing = it }, { deleting = it }) }, onClick = null) {
                                MessageRow(message, model.author(message.authorId), compact, downloading, { open(it) }, { open(it, share = true) })
                            }
                        }
                        if (previous == null || !sameDay(previous.createdAt, message.createdAt)) {
                            item(key = "day-${message.id}") { DayDivider(message.createdAt) }
                        }
                    }
                    item(key = "top") {
                        when {
                            model.hasOlder -> Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                                if (model.isLoadingOlder) SmallProgress() else TextButton(onClick = { scope.launch { model.loadOlder() } }) { Text("Ältere Nachrichten laden") }
                            }
                            model.detail != null -> ConversationIntro(model.detail!!)
                        }
                    }
                }
            }
        }
    }

    if (showDetails) ConversationDetailsView(session, model) { showDetails = false }
    editing?.let { m -> EditMessageSheet(model, m, limits) { editing = null } }
    deleting?.let { m ->
        ConfirmDialog("Nachricht löschen?", "Die Nachricht und ihre Anhänge werden entfernt. Ein Platzhalter bleibt sichtbar.", "Löschen", onConfirm = {
            scope.launch {
                try {
                    model.delete(m.id)
                } catch (e: ApiError) {
                    failure = ActionFailure.of("Löschen fehlgeschlagen", e)
                }
            }
        }, onDismiss = { deleting = null })
    }
    FailureAlert(failure) { failure = null }
}

private fun sameDay(a: Instant, b: Instant): Boolean {
    val zone = ZoneId.systemDefault()
    return a.atZone(zone).toLocalDate() == b.atZone(zone).toLocalDate()
}

private fun messageMenu(
    context: Context,
    session: SessionModel,
    model: ConversationModel,
    message: Message,
    edit: (Message) -> Unit,
    delete: (Message) -> Unit,
): List<MenuEntry> = buildList {
    if (message.deleted) return@buildList
    if (message.body.isNotEmpty()) {
        add(MenuEntry.Item("Kopieren", Icons.Filled.ContentCopy) {
            context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Nachricht", message.body))
        })
    }
    if (message.authorId == session.userId) {
        if (model.canPost) add(MenuEntry.Item("Bearbeiten", Icons.Filled.Edit) { edit(message) })
        add(MenuEntry.Item("Löschen …", Icons.Filled.Delete, destructive = true) { delete(message) })
    }
}

@Composable
private fun EditMessageSheet(model: ConversationModel, message: Message, limits: Limits, onDismiss: () -> Unit) {
    var text by remember { mutableStateOf(message.body) }
    var failure by remember { mutableStateOf<ActionFailure?>(null) }
    val scope = rememberMainScope()
    val tooLong = text.length > limits.maxMessageLength
    FormSheet(
        "Nachricht bearbeiten", onDismiss, confirmLabel = "Sichern",
        confirmEnabled = !tooLong && !(text.isBlank() && message.attachments.isEmpty()),
        onConfirm = {
            scope.launch {
                try {
                    model.edit(message.id, text)
                    onDismiss()
                } catch (e: ApiError) {
                    failure = ActionFailure.of("Nicht gespeichert", e)
                }
            }
        },
    ) {
        GroupedList {
            section("text", footer = if (tooLong) "Eine Nachricht darf höchstens ${limits.maxMessageLength} Zeichen lang sein." else null) {
                row { FormTextField(text, { text = it }, "Nachricht", minLines = 3, autoFocus = true) }
            }
        }
    }
    FailureAlert(failure) { failure = null }
}

// MARK: - Pieces

@Composable
private fun Composer(model: ConversationModel, limits: Limits, onPhotos: () -> Unit, onFiles: () -> Unit, onSend: () -> Unit) {
    val scope = rememberMainScope()
    var attachMenu by remember { mutableStateOf(false) }
    val tooLong = model.draft.length > limits.maxMessageLength
    val canSend = model.canSend && !tooLong
    Column(Modifier.fillMaxWidth().background(Tokens.Palette.surfaceSubtle)) {
        HorizontalDivider(color = Tokens.Palette.border)
        if (model.attachments.isNotEmpty()) {
            LazyRow(contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(model.attachments, key = { it.id }) { a -> ComposerAttachmentChip(a) { scope.launch { model.removeAttachment(a.id) } } }
            }
        }
        if (tooLong) {
            Text(
                "Eine Nachricht darf höchstens ${Formatting.number(limits.maxMessageLength)} Zeichen lang sein.",
                style = VType.caption, color = Tokens.Palette.destructive, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.Bottom) {
            Box {
                IconButton(onClick = { attachMenu = true }, enabled = model.attachments.size < limits.maxFilesPerMessage) {
                    Icon(Icons.Filled.AttachFile, "Anhang hinzufügen", tint = Tokens.Palette.accentBlue)
                }
                EntryMenu(attachMenu, { attachMenu = false }, listOf(
                    MenuEntry.Item("Fotos", Icons.Outlined.Image, onClick = onPhotos),
                    MenuEntry.Item("Dateien", Icons.Outlined.Folder, onClick = onFiles),
                ))
            }
            BasicTextField(
                value = model.draft,
                onValueChange = { model.draft = it },
                textStyle = VType.body.copy(color = Tokens.Palette.foreground),
                cursorBrush = SolidColor(Tokens.Palette.accentBlue),
                maxLines = 6,
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 40.dp)
                    .background(Tokens.Palette.background, RoundedCornerShape(18.dp))
                    .padding(horizontal = 12.dp, vertical = 9.dp)
                    .semantics { contentDescription = "Nachricht" },
                decorationBox = { inner ->
                    Box {
                        if (model.draft.isEmpty()) Text("Nachricht", style = VType.body, color = Tokens.Palette.mutedForeground)
                        inner()
                    }
                },
            )
            IconButton(onClick = onSend, enabled = canSend) {
                Icon(Icons.AutoMirrored.Filled.Send, "Senden", tint = if (canSend) Tokens.Palette.accentBlue else Tokens.Palette.borderStrong)
            }
        }
    }
}

@Composable
private fun ComposerAttachmentChip(attachment: ComposerAttachment, remove: () -> Unit) {
    Row(Modifier.widthIn(max = 240.dp).cardSurface().padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        when (attachment.state) {
            ComposerAttachment.State.Uploading -> SmallProgress()
            is ComposerAttachment.State.Ready -> Icon(Icons.Outlined.Description, null, tint = Tokens.Palette.mutedForeground, modifier = Modifier.size(18.dp))
            is ComposerAttachment.State.Failed -> Icon(Icons.Outlined.WarningAmber, null, tint = Tokens.Palette.destructive, modifier = Modifier.size(18.dp))
        }
        Column(Modifier.weight(1f, fill = false)) {
            Text(attachment.fileName, style = VType.caption, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val state = attachment.state
            if (state is ComposerAttachment.State.Failed) {
                Text(state.message, style = VType.caption2, color = Tokens.Palette.destructive, maxLines = 2)
            } else {
                Text(ByteFormatting.string(attachment.sizeBytes), style = VType.caption2, color = Tokens.Palette.mutedForeground)
            }
        }
        IconButton(onClick = remove, modifier = Modifier.size(28.dp)) {
            Icon(Icons.Filled.Cancel, "„${attachment.fileName}“ entfernen", tint = Tokens.Palette.mutedForeground, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun MessageRow(
    message: Message,
    author: ChatPerson?,
    compact: Boolean,
    downloading: String?,
    onOpen: (Attachment) -> Unit,
    onShare: (Attachment) -> Unit,
) {
    Row(Modifier.fillMaxWidth().padding(top = if (compact) 2.dp else 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (compact) Spacer(Modifier.width(32.dp)) else Avatar(author?.fullName, author?.email, size = 32.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (!compact) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                    Text(author?.displayName ?: "Ehemaliges Mitglied", style = VType.dense.copy(fontWeight = FontWeight.SemiBold))
                    Text(Formatting.time(message.createdAt), style = VType.caption, color = Tokens.Palette.mutedForeground)
                }
            }
            if (message.deleted) {
                Text("Nachricht gelöscht", style = VType.body.copy(fontStyle = FontStyle.Italic), color = Tokens.Palette.mutedForeground)
            } else {
                if (message.body.isNotEmpty()) {
                    // No SelectionContainer: it would capture the long press that opens the message menu ("Kopieren" copies).
                    Text(linkified(message.body, edited = message.editedAt != null), style = VType.body)
                }
                for (a in message.attachments) AttachmentCard(a, downloading == a.id, { onOpen(a) }, { onShare(a) })
            }
        }
    }
}

/** Plain text with clickable links (no HTML/Markdown, like the web). */
private val linkPattern = Regex("""(https?://[^\s<>"]+|mailto:[^\s<>"]+)""")

private fun linkified(text: String, edited: Boolean): AnnotatedString = buildAnnotatedString {
    var last = 0
    for (match in linkPattern.findAll(text)) {
        val url = match.value.trimEnd('.', ',', ')', ';', ':', '!', '?')
        append(text.substring(last, match.range.first))
        withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(color = Tokens.Palette.accentBlueText)))) { append(url) }
        last = match.range.first + url.length
    }
    append(text.substring(last))
    if (edited) withStyle(SpanStyle(color = Tokens.Palette.mutedForeground, fontSize = VType.caption.fontSize)) { append(" (bearbeitet)") }
}

@Composable
private fun PendingMessageRow(pending: PendingMessage, retry: () -> Unit, discard: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Spacer(Modifier.width(32.dp))
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (pending.body.isNotEmpty()) Text(pending.body, color = Tokens.Palette.mutedForeground)
            for (a in pending.attachments) Text(a.fileName, style = VType.caption, color = Tokens.Palette.mutedForeground)
            val failure = pending.failure
            if (failure != null) {
                Text("Nicht gesendet: $failure", style = VType.caption, color = Tokens.Palette.destructive)
                Row {
                    TextButton(onClick = retry) { Text("Erneut senden", style = VType.caption.copy(fontWeight = FontWeight.SemiBold)) }
                    TextButton(onClick = discard) { Text("Verwerfen", style = VType.caption, color = Tokens.Palette.destructive) }
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(Icons.Outlined.Schedule, null, tint = Tokens.Palette.mutedForeground, modifier = Modifier.size(12.dp))
                    Text("Wird gesendet …", style = VType.caption, color = Tokens.Palette.mutedForeground)
                }
            }
        }
    }
}

@Composable
private fun AttachmentCard(attachment: Attachment, loading: Boolean, open: () -> Unit, share: () -> Unit) {
    val icon = when {
        attachment.mimeType.startsWith("image/") -> Icons.Outlined.Image
        attachment.mimeType == "application/pdf" -> Icons.Outlined.PictureAsPdf
        else -> Icons.Outlined.Description
    }
    Box(Modifier.widthIn(max = 320.dp)) {
        MenuTarget({
            listOf(
                MenuEntry.Item("Öffnen", Icons.Outlined.Download, onClick = open),
                MenuEntry.Item("Teilen", Icons.Filled.Share, onClick = share),
            )
        }, onClick = open, onClickLabel = "Lädt die Datei und öffnet sie") {
            Row(
                Modifier.cardSurface().padding(12.dp).semantics(mergeDescendants = true) {
                    contentDescription = "Datei ${attachment.fileName}, ${ByteFormatting.string(attachment.sizeBytes)}"
                },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Icon(icon, null, tint = Tokens.Palette.accentBlue)
                Column(Modifier.weight(1f)) {
                    Text(attachment.fileName, style = VType.dense, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(ByteFormatting.string(attachment.sizeBytes), style = VType.caption, color = Tokens.Palette.mutedForeground)
                }
                if (loading) SmallProgress() else Icon(Icons.Outlined.Download, null, tint = Tokens.Palette.mutedForeground)
            }
        }
    }
}

@Composable
private fun DayDivider(instant: Instant) {
    Row(Modifier.fillMaxWidth().padding(vertical = 12.dp).semantics { heading() }, verticalAlignment = Alignment.CenterVertically) {
        HorizontalDivider(Modifier.weight(1f), color = Tokens.Palette.border)
        Text(Formatting.dayHeading(instant), style = VType.caption.copy(fontWeight = FontWeight.Medium), color = Tokens.Palette.mutedForeground, modifier = Modifier.padding(horizontal = 8.dp))
        HorizontalDivider(Modifier.weight(1f), color = Tokens.Palette.border)
    }
}

@Composable
private fun ConversationIntro(detail: ConversationDetail) {
    Column(Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(if (detail.kind == ConversationKind.Dm) detail.title else "# ${detail.title}", style = VType.sectionTitle)
        Text(
            detail.description.ifEmpty { if (detail.kind == ConversationKind.Dm) "Der Anfang eurer Unterhaltung." else "Der Anfang des Kanals." },
            style = VType.dense,
            color = Tokens.Palette.mutedForeground,
        )
    }
}

// MARK: - Files

/**
 * System picker filter from the server allowlist. Providers report MIME types differently
 * (e.g. CSV as `text/comma-separated-values`), so the filter is derived from the allowed
 * extensions too — like iOS (UTType from extension). The extension check before the upload
 * and the server check stay authoritative.
 */
internal fun allowedMimeTypes(limits: Limits): Array<String> {
    val aliases = mapOf(
        "csv" to listOf("text/comma-separated-values", "application/csv", "text/x-csv", "application/vnd.ms-excel"),
        "txt" to listOf("text/x-log"),
        "jpg" to listOf("image/pjpeg"),
    )
    val types = limits.allowedFileTypes.flatMap { t ->
        listOf(t.mimeType) + t.extensions.flatMap { ext ->
            listOfNotNull(android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)) + aliases[ext].orEmpty()
        }
    }
    return types.distinct().toTypedArray().ifEmpty { arrayOf("*/*") }
}

/** Photos are converted to JPEG (on the allowlist); re-encoding drops all metadata incl. GPS. */
private suspend fun addPhotos(context: Context, model: ConversationModel, uris: List<Uri>, limits: Limits, fail: (ActionFailure) -> Unit) {
    val room = (limits.maxFilesPerMessage - model.attachments.size).toInt().coerceAtLeast(0)
    val date = java.time.LocalDate.now().toString()
    uris.take(room).forEachIndexed { i, uri ->
        val jpeg = withContext(Dispatchers.IO) {
            runCatching {
                val bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, _, _ ->
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                }
                ByteArrayOutputStream().use { out ->
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
                    out.toByteArray()
                }
            }.getOrNull()
        }
        if (jpeg == null) {
            fail(ActionFailure("Bild nicht geladen", "Dieses Bildformat wird nicht unterstützt."))
            return@forEachIndexed
        }
        model.addAttachment(jpeg, "Foto-$date-${i + 1}.jpg", limits)?.let { fail(ActionFailure("Anhang nicht möglich", it)) }
    }
}

private suspend fun addFiles(context: Context, model: ConversationModel, uris: List<Uri>, limits: Limits, fail: (ActionFailure) -> Unit) {
    for (uri in uris) {
        val (name, size) = withContext(Dispatchers.IO) {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) (c.getString(0) ?: "Datei") to (if (c.isNull(1)) 0L else c.getLong(1)) else null
            } ?: ("Datei" to 0L)
        }
        // Check size before reading the file into memory.
        model.precheck(name, size, limits)?.let {
            fail(ActionFailure("Anhang nicht möglich", it))
            continue
        }
        val data = withContext(Dispatchers.IO) { runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull() }
        if (data == null) {
            fail(ActionFailure("Datei nicht gelesen", "„$name“ konnte nicht gelesen werden."))
            continue
        }
        model.addAttachment(data, name, limits)?.let { fail(ActionFailure("Anhang nicht möglich", it)) }
    }
}

/** Opens (or shares) a downloaded attachment through a content:// URI (FileProvider). */
private fun openFile(context: Context, file: File, mimeType: String, share: Boolean) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    val intent = if (share) {
        Intent(Intent.ACTION_SEND).apply {
            type = mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
        }
    } else {
        Intent(Intent.ACTION_VIEW).setDataAndType(uri, mimeType)
    }
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    // No app can display this type (iOS would show Quick Look): offer sharing/saving instead.
    val canView = share || context.packageManager.queryIntentActivities(intent, 0).isNotEmpty()
    if (!canView) return openFile(context, file, mimeType, share = true)
    context.startActivity(if (share) Intent.createChooser(intent, file.name) else Intent.createChooser(intent, "Öffnen mit"))
}
