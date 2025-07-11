package com.privastreamsolutions.privastreamcinema.adapter

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.fragment.app.FragmentActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.privastreamsolutions.privastreamcinema.R
import com.privastreamsolutions.privastreamcinema.model.MediaItem

class SectionAdapter(
    private var sections: Map<String, List<MediaItem>>,
    private val activity: FragmentActivity
) : RecyclerView.Adapter<SectionAdapter.SectionViewHolder>() {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): SectionViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_catalog_section, parent, false)
        return SectionViewHolder(view, parent.context)
    }

    override fun getItemCount(): Int = sections.size

    override fun onBindViewHolder(holder: SectionViewHolder, position: Int) {
        val title = sections.keys.toList()[position]
        val items = sections[title] ?: emptyList()
        holder.bind(title, items)
    }

    fun updateSections(newSections: Map<String, List<MediaItem>>) {
        sections = newSections
        notifyDataSetChanged()
    }

    class SectionViewHolder(itemView: View, private val context: Context) :
        RecyclerView.ViewHolder(itemView) {

        private val sectionTitle: TextView = itemView.findViewById(R.id.sectionTitle)
        private val mediaList: RecyclerView = itemView.findViewById(R.id.mediaList)

        fun bind(title: String, items: List<MediaItem>) {
            sectionTitle.text = title // ✅ Dynamically sets tray header
            mediaList.layoutManager = LinearLayoutManager(context, LinearLayoutManager.HORIZONTAL, false)
            mediaList.adapter = MediaAdapter(items)
        }
    }

    class MediaAdapter(private val items: List<MediaItem>) :
        RecyclerView.Adapter<MediaAdapter.MediaViewHolder>() {

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MediaViewHolder {
            val view = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_poster, parent, false)
            return MediaViewHolder(view)
        }

        override fun getItemCount(): Int = items.size

        override fun onBindViewHolder(holder: MediaViewHolder, position: Int) {
            holder.bind(items[position])
        }

        class MediaViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
            private val poster: ImageView = itemView.findViewById(R.id.posterImage)

            fun bind(item: MediaItem) {
                Glide.with(itemView.context)
                    .load(item.poster ?: "")
                    .into(poster) // ✅ Only posters shown
            }
        }
    }
}