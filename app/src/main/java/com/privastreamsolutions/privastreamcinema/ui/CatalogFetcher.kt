package com.privastreamsolutions.privastreamcinema.ui

import android.util.Log
import com.privastreamsolutions.privastreamcinema.model.*
import com.privastreamsolutions.privastreamcinema.network.CatalogService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.withContext
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

object CatalogFetcher {

    suspend fun fetchAllSections(addons: List<AddonManifest>): List<CatalogSection> {
        return withContext(Dispatchers.IO) {
            val deferredSections = addons.map { addon ->
                async {
                    try {
                        fetchCatalogForAddon(addon)
                    } catch (e: Exception) {
                        Log.e("CatalogFetcher", "Error loading ${addon.name}", e)
                        null
                    }
                }
            }
            deferredSections.awaitAll().filterNotNull()
        }
    }

    private suspend fun fetchCatalogForAddon(addon: AddonManifest): CatalogSection? {
        val catalog = addon.catalogs?.firstOrNull() ?: return null
        val type = catalog.type
        val id = catalog.name // Or update if a separate `id` field is added later

        var baseUrl = addon.addonUrl?.removeSuffix("manifest.json") ?: return null
        if (!baseUrl.endsWith("/")) baseUrl += "/"

        val retrofit = Retrofit.Builder()
            .baseUrl(baseUrl)
            .addConverterFactory(GsonConverterFactory.create())
            .build()

        val service = retrofit.create(CatalogService::class.java)
        val response = service.getCatalogByType(type, id)
        val url = "$baseUrl/catalog/$type/$id.json"

        return CatalogSection(addon.name, response.metas)
    }
}