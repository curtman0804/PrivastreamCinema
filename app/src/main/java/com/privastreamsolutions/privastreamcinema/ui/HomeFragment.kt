package com.privastreamsolutions.privastreamcinema.ui

import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.privastreamsolutions.privastreamcinema.R
import com.privastreamsolutions.privastreamcinema.model.MediaItem
import com.privastreamsolutions.privastreamcinema.util.InstalledAddons
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject

class HomeFragment : Fragment() {

    private lateinit var catalogList: RecyclerView
    private val mediaItems = mutableListOf<MediaItem>()
    private val client = OkHttpClient()

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View? {
        return inflater.inflate(R.layout.fragment_home, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        catalogList = view.findViewById(R.id.catalogList)
        catalogList.layoutManager = GridLayoutManager(requireContext(), 2)

        lifecycleScope.launch {
            fetchAllCatalogs()
            Log.d("HomeDebug", "Total mediaItems loaded: ${mediaItems.size}")
            catalogList.adapter = MediaAdapter(mediaItems, requireActivity())
        }
    }

    private suspend fun fetchAllCatalogs() {
        mediaItems.clear()

        for (addon in InstalledAddons.all()) {
            val catalogs = addon.catalogs ?: continue
            val baseUrl = addon.addonUrl
                ?.removeSuffix("manifest.json")
                ?.removeSuffix("/") ?: continue

            Log.d("HomeDebug", "Checking ${addon.name}, catalogs count: ${catalogs.size}")

            for (catalog in catalogs) {
                val fullUrl = "$baseUrl/catalog/${catalog.type}/${catalog.id}.json"
                Log.d("HomeDebug", "Fetching: $fullUrl")

                try {
                    val metasArray = withContext(Dispatchers.IO) {
                        val request = Request.Builder().url(fullUrl).build()
                        val response = client.newCall(request).execute()
                        val rawJson = response.body()?.string() ?: ""

                        if (rawJson.trim().startsWith("<!DOCTYPE") || rawJson.contains("<html")) {
                            throw Exception("Received HTML instead of JSON")
                        }

                        val wrapper = JSONObject(rawJson)
                        wrapper.getJSONArray("metas")
                    }

                    Log.d("HomeDebug", "Items received: ${metasArray.length()}")

                    for (i in 0 until metasArray.length()) {
                        val obj = metasArray.getJSONObject(i)
                        val media = MediaItem(
                            name = obj.optString("name"),
                            poster = obj.optString("poster"),
                            description = obj.optString("description"),
                            streamUrl = obj.optString("id") // Assuming you're using the ID to fetch the stream later
                        )
                        mediaItems.add(media)
                    }
                } catch (e: Exception) {
                    Log.e("HomeDebug", "Failed to fetch: $fullUrl", e)
                }
            }
        }
    }
}