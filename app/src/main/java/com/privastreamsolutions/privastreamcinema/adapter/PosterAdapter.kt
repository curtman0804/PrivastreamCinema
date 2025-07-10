package com.privastreamsolutions.privastreamcinema.adapter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.privastreamsolutions.privastreamcinema.R
import com.privastreamsolutions.privastreamcinema.model.CatalogEntry

class PosterAdapter(private val entries: List<CatalogEntry>) :
    RecyclerView.Adapter<PosterAdapter.PosterViewHolder>() {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PosterViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_catalog_entry, parent, false)
        return PosterViewHolder(view)
    }

    override fun getItemCount(): Int = entries.size

    override fun onBindViewHolder(holder: PosterViewHolder, position: Int) {
        holder.bind(entries[position])
    }

    class PosterViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        private val posterView = view.findViewById<ImageView>(R.id.posterView)

        fun bind(entry: CatalogEntry) {
            Glide.with(itemView.context)
                .load(entry.poster)
                .error(R.drawable.blank_folder)
                .centerCrop()
                .into(posterView)
        }
    }
}