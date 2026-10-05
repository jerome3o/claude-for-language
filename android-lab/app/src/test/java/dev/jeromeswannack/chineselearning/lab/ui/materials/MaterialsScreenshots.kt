package dev.jeromeswannack.chineselearning.lab.ui.materials

import dev.jeromeswannack.chineselearning.lab.data.materials.UploadStage
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test
import org.robolectric.annotation.Config

/** Calls round 4 PR 5: `/materials` (list, upload, share) and `/materials/:id` (the viewer). */
class MaterialsScreenshots : LabScreenshotTest() {
    private val students = listOf(MaterialStudent("r1", "Jerome Swannack"), MaterialStudent("r2", "李明"))
    private val ui = MaterialsUi(materials = MaterialsSamples.list, students = students)

    @Test fun list() = shoot("lab-materials-01-list") { MaterialsScreen(ui, MaterialsActions()) }

    @Config(qualifiers = UNFOLDED)
    @Test fun listUnfolded() = shoot("lab-materials-02-list-unfolded") { MaterialsScreen(ui, MaterialsActions()) }

    @Test fun uploading() = shoot("lab-materials-03-uploading") { MaterialsScreen(ui.copy(stage = UploadStage.Uploading(4, 12)), MaterialsActions()) }

    @Test fun share() = shoot("lab-materials-04-share-sheet") { MaterialsScreen(ui, MaterialsActions(), initialSharing = MaterialsSamples.lesson5) }

    private val viewer = MaterialViewerUi(detail = MaterialsSamples.detail, loading = false, page = 1, image = MaterialsSamples.slideBitmap(1))

    @Test fun viewer() = shoot("lab-materials-05-viewer") { MaterialViewerScreen(viewer, MaterialViewerActions()) }

    @Test fun viewerText() = shoot("lab-materials-06-viewer-text-offline") {
        MaterialViewerScreen(viewer.copy(showText = true, offline = true, kept = MaterialViewerUi.Kept.YES), MaterialViewerActions())
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun viewerUnfolded() = shoot("lab-materials-07-viewer-unfolded") { MaterialViewerScreen(viewer, MaterialViewerActions()) }

    /** Round 6: ☰ Contents — the slide titles, the one on show marked. */
    @Test fun viewerContents() = shoot("lab-materials-08-viewer-contents") { MaterialViewerScreen(viewer, MaterialViewerActions(), initialContentsOpen = true) }

    /** No outline stored (an older upload / a PDF from the phone): its pages by their first line. */
    @Test fun viewerContentsPages() = shoot("lab-materials-09-viewer-contents-pages") {
        MaterialViewerScreen(viewer.copy(detail = MaterialsSamples.detail.copy(material = MaterialsSamples.detail.material.copy(toc = null))), MaterialViewerActions(), initialContentsOpen = true)
    }
}
