package com.privastreamsolutions.privastreamcinema.ui

import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.privastreamsolutions.privastreamcinema.R
import com.privastreamsolutions.privastreamcinema.model.AddonManifest
import com.privastreamsolutions.privastreamcinema.network.CatalogService
import com.privastreamsolutions.privastreamcinema.util.InstalledAddons
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class PasteManagementFragment : Fragment(R.layout.fragment_paste_management) {

    private lateinit var pasteInput: EditText
    private lateinit var installButton: Button

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        pasteInput = view.findViewById(R.id.pasteInput)
        installButton = view.findViewById(R.id.installButton)

        installButton.setOnClickListener {
            val url = pasteInput.text.toString()
            if (url.isNotBlank()) {
                installAddon(url)
            } else {
                Toast.makeText(requireContext(), "Paste a valid URL", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun installAddon(url: String) {
        lifecycleScope.launch {
            try {
                val retrofit = Retrofit.Builder()
                    .baseUrl(if (url.endsWith("manifest.json")) url.removeSuffix("manifest.json") else url)
                    .addConverterFactory(GsonConverterFactory.create())
                    .build()

                val service = retrofit.create(CatalogService::class.java)
                val manifest = withContext(Dispatchers.IO) {
                    service.fetchManifest()
                }

                manifest.addonUrl = url // stash full URL for future use
                InstalledAddons.add(manifest)

                Toast.makeText(requireContext(), "Installed: ${manifest.name}", Toast.LENGTH_SHORT).show()
                pasteInput.setText("")
            } catch (e: Exception) {
                Toast.makeText(requireContext(), "Install failed: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }
}