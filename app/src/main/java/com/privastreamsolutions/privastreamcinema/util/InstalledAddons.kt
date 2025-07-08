package com.privastreamsolutions.privastreamcinema.util

import com.privastreamsolutions.privastreamcinema.model.AddonManifest

object InstalledAddons {
    private val installed = mutableListOf<AddonManifest>()

    fun add(manifest: AddonManifest) {
        if (!installed.any { it.id == manifest.id }) {
            installed.add(manifest)
        }
    }

    fun getAll(): List<AddonManifest> = installed
}