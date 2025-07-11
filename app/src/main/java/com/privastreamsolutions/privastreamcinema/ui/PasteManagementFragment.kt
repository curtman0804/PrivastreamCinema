package com.privastreamsolutions.privastreamcinema.ui

import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.bumptech.glide.Glide
import com.privastreamsolutions.privastreamcinema.R
import com.privastreamsolutions.privastreamcinema.model.AddonCatalog
import com.privastreamsolutions.privastreamcinema.model.AddonManifest
import com.privastreamsolutions.privastreamcinema.util.InstalledAddons
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

class PasteManagementFragment : Fragment() {

    private lateinit var pasteInput: EditText
    private lateinit var pasteButton: Button
    private lateinit var pasteStatus: TextView
    private lateinit var addonList: LinearLayout
    private val client = OkHttpClient()

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View? {
        return inflater.inflate(R.layout.fragment_paste_management, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        pasteInput = view.findViewById(R.id.pasteInput)
        pasteButton = view.findViewById(R.id.pasteButton)
        pasteStatus = view.findViewById(R.id.pasteStatus)
        addonList = view.findViewById(R.id.addonList)

        pasteInput.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) {
                pasteButton.isEnabled = !s.isNullOrBlank()
            }
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        })

        pasteButton.setOnClickListener {
            val url = pasteInput.text.toString().trim()
            if (url.isNotBlank()) installManifest(url)
        }

        arguments?.getString("manifestUrl")?.let {
            pasteInput.setText(it)
            installManifest(it)
        }

        renderInstalledAddons()
    }

    private fun installManifest(url: String) {
        pasteStatus.text = "Fetching manifest…"

        lifecycleScope.launch {
            try {
                val rawJson = withContext(Dispatchers.IO) {
                    val request = Request.Builder()
                        .url(url)
                        .header("User-Agent", "Privastream/1.0") // Important for manifest servers
                        .build()
                    val response = client.newCall(request).execute()
                    response.body?.string() ?: throw Exception("Empty response")
                }

                val json = JSONObject(rawJson)
                val catalogArray = json.optJSONArray("catalogs")
                val parsedCatalogs = mutableListOf<AddonCatalog>()

                catalogArray?.let { array ->
                    for (i in 0 until array.length()) {
                        val obj = array.getJSONObject(i)
                        val id = obj.optString("id", "")
                        val type = obj.optString("type", "")
                        val name = obj.optString("name", "Unnamed")
                        if (id.isNotBlank() && type.isNotBlank()) {
                            parsedCatalogs.add(AddonCatalog(name, type, id))
                        }
                    }
                }

                val manifest = AddonManifest(
                    id = url.hashCode().toString(),
                    name = json.optString("name", "Untitled Addon"),
                    description = json.optString("description", null),
                    version = json.optString("version", null),
                    logo = json.optString("logo", null),
                    catalogs = parsedCatalogs,
                    addonUrl = url
                )

                InstalledAddons.install(manifest)
                pasteStatus.text = "Installed: ${manifest.name} (${manifest.catalogs?.size ?: 0} catalogs)"
                renderInstalledAddons()

            } catch (e: Exception) {
                Log.e("PasteDebug", "Failed to install manifest", e)
                pasteStatus.text = "Failed to install: ${e.message}"
            }
        }
    }

    private fun renderInstalledAddons() {
        addonList.removeAllViews()

        for (addon in InstalledAddons.all()) {
            val context = requireContext()

            val block = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, 12, 0, 12)
            }

            val icon = ImageView(context).apply {
                layoutParams = LinearLayout.LayoutParams(100, 100)
            }

            Glide.with(context)
                .load(addon.logo ?: "")
                .placeholder(R.drawable.blank_folder)
                .error(R.drawable.blank_folder)
                .into(icon)

            val shortDesc = addon.description?.substringBefore('.')?.plus(".") ?: ""

            val text = TextView(context).apply {
                text = "${addon.name}\n$shortDesc"
                setTextColor(resources.getColor(android.R.color.white, null))
                textSize = 14f
                setPadding(16, 0, 0, 0)
            }

            block.addView(icon)
            block.addView(text)
            addonList.addView(block)
        }
    }
}